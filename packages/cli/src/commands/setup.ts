import { Command } from 'commander'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { SESv2Client, CreateEmailIdentityCommand, GetEmailIdentityCommand, CreateConfigurationSetCommand, CreateConfigurationSetEventDestinationCommand } from '@aws-sdk/client-sesv2'
import { SESClient, CreateReceiptRuleSetCommand, SetActiveReceiptRuleSetCommand, CreateReceiptRuleCommand, DescribeActiveReceiptRuleSetCommand } from '@aws-sdk/client-ses'
import { S3Client, CreateBucketCommand, PutBucketPolicyCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { SNSClient, CreateTopicCommand } from '@aws-sdk/client-sns'

const SES_INBOUND_REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1']

export const setupCommand = new Command('setup').description('Provision infrastructure for Pigeons')

setupCommand
  .command('aws')
  .description('Set up AWS resources (SES, S3, SNS) for a Pigeons instance')
  .option('--region <region>', 'AWS region')
  .option('--domain <domain>', 'Email domain to configure')
  .option('--access-key-id <key>', 'AWS access key ID')
  .option('--secret-access-key <key>', 'AWS secret access key')
  .option('--skip-inbound', 'Skip inbound email setup (S3, SNS inbound topic, receipt rule)')
  .action(async (opts) => {
    const rl = createInterface({ input: stdin, output: stdout })
    const failures: string[] = []

    try {
      console.log('\n  Pigeons AWS Setup Wizard\n')

      // 1. Collect credentials
      const accessKeyId = opts.accessKeyId
        ?? process.env.AWS_ACCESS_KEY_ID
        ?? process.env.PIGEONS_AWS_ACCESS_KEY_ID
        ?? await rl.question('  AWS Access Key ID: ')

      const secretAccessKey = opts.secretAccessKey
        ?? process.env.AWS_SECRET_ACCESS_KEY
        ?? process.env.PIGEONS_AWS_SECRET_ACCESS_KEY
        ?? await rl.question('  AWS Secret Access Key: ')

      const credentials = { accessKeyId, secretAccessKey }

      // 2. Validate credentials
      step('Validating AWS credentials')
      const sts = new STSClient({ region: 'us-east-1', credentials })
      let accountId = ''
      try {
        const identity = await sts.send(new GetCallerIdentityCommand({}))
        accountId = identity.Account ?? ''
        ok(`Authenticated as ${identity.Arn}`)
      } catch (err: any) {
        fail('Invalid AWS credentials')
        console.error(`\n  Error: ${err.message}`)
        process.exit(1)
      }

      // 3. Collect region
      const regionInput = opts.region
        ?? process.env.AWS_REGION
        ?? process.env.PIGEONS_AWS_REGION
        ?? await rl.question('  AWS region [us-east-1]: ')
      const region = regionInput || 'us-east-1'

      if (!SES_INBOUND_REGIONS.includes(region) && !opts.skipInbound) {
        warn(`SES inbound email only works in: ${SES_INBOUND_REGIONS.join(', ')}`)
        warn(`Region '${region}' supports sending only. Inbound setup will be skipped.`)
        opts.skipInbound = true
      }

      // 4. Collect domain
      const domain = opts.domain ?? await rl.question('  Email domain (e.g. example.com): ')
      if (!domain) {
        console.error('\n  Error: Domain is required.')
        process.exit(1)
      }

      const slug = domain.replace(/\./g, '-')
      const sesv2 = new SESv2Client({ region, credentials })
      const ses = new SESClient({ region, credentials })
      const s3 = new S3Client({ region, credentials })
      const sns = new SNSClient({ region, credentials })

      console.log()

      // 5. Create SES domain identity
      let dkimTokens: string[] = []
      step('Creating SES domain identity')
      try {
        const res = await sesv2.send(new CreateEmailIdentityCommand({ EmailIdentity: domain }))
        dkimTokens = res.DkimAttributes?.Tokens ?? []
        ok(`Created SES identity for ${domain}`)
      } catch (err: any) {
        if (err.name === 'AlreadyExistsException') {
          try {
            const existing = await sesv2.send(new GetEmailIdentityCommand({ EmailIdentity: domain }))
            dkimTokens = existing.DkimAttributes?.Tokens ?? []
          } catch { /* tokens unavailable */ }
          ok(`SES identity for ${domain} already exists`)
        } else {
          fail(`SES identity: ${err.message}`)
          failures.push('SES domain identity — requires ses:CreateEmailIdentity permission')
        }
      }

      // 6. Create SES configuration set
      const configSetName = 'pigeons-tracking'
      step('Creating SES configuration set')
      try {
        await sesv2.send(new CreateConfigurationSetCommand({ ConfigurationSetName: configSetName }))
        ok(`Created configuration set: ${configSetName}`)
      } catch (err: any) {
        if (err.name === 'AlreadyExistsException') {
          ok(`Configuration set ${configSetName} already exists`)
        } else {
          fail(`Configuration set: ${err.message}`)
          failures.push('SES configuration set — requires ses:CreateConfigurationSet permission')
        }
      }

      // 7. Create SNS topic for events (delivery/bounce/complaint)
      let eventsTopicArn = ''
      const eventsTopicName = `pigeons-events-${slug}`
      step('Creating SNS topic for email events')
      try {
        const eventsTopic = await sns.send(new CreateTopicCommand({ Name: eventsTopicName }))
        eventsTopicArn = eventsTopic.TopicArn!
        ok(`Events topic: ${eventsTopicArn}`)
      } catch (err: any) {
        fail(`SNS events topic: ${err.message}`)
        failures.push(`SNS events topic (${eventsTopicName}) — requires sns:CreateTopic permission`)
      }

      // 8. Add SNS event destination to configuration set
      if (eventsTopicArn) {
        step('Configuring event destination')
        try {
          await sesv2.send(new CreateConfigurationSetEventDestinationCommand({
            ConfigurationSetName: configSetName,
            EventDestinationName: 'pigeons-sns-events',
            EventDestination: {
              Enabled: true,
              MatchingEventTypes: ['SEND', 'DELIVERY', 'BOUNCE', 'COMPLAINT'],
              SnsDestination: { TopicArn: eventsTopicArn },
            },
          }))
          ok('Event destination configured')
        } catch (err: any) {
          if (err.name === 'AlreadyExistsException') {
            ok('Event destination already exists')
          } else {
            fail(`Event destination: ${err.message}`)
            failures.push('SES event destination — requires ses:CreateConfigurationSetEventDestination permission')
          }
        }
      }

      let bucketName = ''
      let inboundTopicArn = ''

      if (!opts.skipInbound) {
        // 9. Create S3 bucket for inbound emails
        bucketName = `pigeons-inbound-${slug}`
        step('Creating S3 bucket for inbound emails')
        try {
          try {
            await s3.send(new HeadBucketCommand({ Bucket: bucketName }))
            ok(`S3 bucket ${bucketName} already exists`)
          } catch (headErr: any) {
            if (headErr.name === 'NotFound' || headErr.$metadata?.httpStatusCode === 404) {
              const bucketParams: any = { Bucket: bucketName }
              if (region !== 'us-east-1') {
                bucketParams.CreateBucketConfiguration = { LocationConstraint: region }
              }
              await s3.send(new CreateBucketCommand(bucketParams))
              ok(`Created S3 bucket: ${bucketName}`)
            } else if (headErr.name === 'Forbidden' || headErr.$metadata?.httpStatusCode === 403) {
              bucketName = `pigeons-inbound-${slug}-${accountId}`
              const bucketParams: any = { Bucket: bucketName }
              if (region !== 'us-east-1') {
                bucketParams.CreateBucketConfiguration = { LocationConstraint: region }
              }
              await s3.send(new CreateBucketCommand(bucketParams))
              ok(`Created S3 bucket: ${bucketName}`)
            } else {
              throw headErr
            }
          }
        } catch (err: any) {
          fail(`S3 bucket: ${err.message}`)
          failures.push(`S3 bucket (${bucketName}) — requires s3:CreateBucket, s3:HeadBucket permissions`)
          bucketName = ''
        }

        // 10. Set S3 bucket policy for SES
        if (bucketName) {
          step('Setting S3 bucket policy for SES')
          try {
            const bucketArn = `arn:aws:s3:::${bucketName}`
            await s3.send(new PutBucketPolicyCommand({
              Bucket: bucketName,
              Policy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{
                  Sid: 'AllowSESPut',
                  Effect: 'Allow',
                  Principal: { Service: 'ses.amazonaws.com' },
                  Action: 's3:PutObject',
                  Resource: `${bucketArn}/*`,
                  Condition: { StringEquals: { 'AWS:SourceAccount': accountId } },
                }],
              }),
            }))
            ok('Bucket policy set')
          } catch (err: any) {
            fail(`Bucket policy: ${err.message}`)
            failures.push(`S3 bucket policy — requires s3:PutBucketPolicy permission`)
          }
        }

        // 11. Create SNS topic for inbound notifications
        const inboundTopicName = `pigeons-inbound-${slug}`
        step('Creating SNS topic for inbound notifications')
        try {
          const inboundTopic = await sns.send(new CreateTopicCommand({ Name: inboundTopicName }))
          inboundTopicArn = inboundTopic.TopicArn!
          ok(`Inbound topic: ${inboundTopicArn}`)
        } catch (err: any) {
          fail(`SNS inbound topic: ${err.message}`)
          failures.push(`SNS inbound topic (${inboundTopicName}) — requires sns:CreateTopic permission`)
        }

        // 12. Create SES receipt rule set and rule
        const ruleSetName = 'pigeons-inbound'
        step('Creating SES receipt rule set')
        try {
          await ses.send(new CreateReceiptRuleSetCommand({ RuleSetName: ruleSetName }))
          ok(`Created rule set: ${ruleSetName}`)
        } catch (err: any) {
          if (err.name === 'AlreadyExistsException') {
            ok(`Rule set ${ruleSetName} already exists`)
          } else {
            fail(`Receipt rule set: ${err.message}`)
            failures.push('SES receipt rule set — requires ses:CreateReceiptRuleSet permission')
          }
        }

        step('Setting active receipt rule set')
        try {
          const active = await ses.send(new DescribeActiveReceiptRuleSetCommand({}))
          if (active.Metadata?.Name === ruleSetName) {
            ok(`Rule set ${ruleSetName} is already active`)
          } else if (active.Metadata?.Name) {
            warn(`Active rule set is '${active.Metadata.Name}', not overwriting`)
            warn(`Run manually: aws ses set-active-receipt-rule-set --rule-set-name ${ruleSetName}`)
          } else {
            await ses.send(new SetActiveReceiptRuleSetCommand({ RuleSetName: ruleSetName }))
            ok(`Activated rule set: ${ruleSetName}`)
          }
        } catch {
          try {
            await ses.send(new SetActiveReceiptRuleSetCommand({ RuleSetName: ruleSetName }))
            ok(`Activated rule set: ${ruleSetName}`)
          } catch (err: any) {
            fail(`Activate rule set: ${err.message}`)
            failures.push('SES active receipt rule set — requires ses:SetActiveReceiptRuleSet permission')
          }
        }

        if (bucketName && inboundTopicArn) {
          step('Creating receipt rule')
          try {
            await ses.send(new CreateReceiptRuleCommand({
              RuleSetName: ruleSetName,
              Rule: {
                Name: `pigeons-${slug}`,
                Enabled: true,
                Recipients: [domain],
                Actions: [
                  {
                    S3Action: {
                      BucketName: bucketName,
                      ObjectKeyPrefix: 'inbound/',
                    },
                  },
                  {
                    SNSAction: {
                      TopicArn: inboundTopicArn,
                      Encoding: 'UTF-8',
                    },
                  },
                ],
                ScanEnabled: true,
              },
            }))
            ok(`Created receipt rule: pigeons-${slug}`)
          } catch (err: any) {
            if (err.name === 'AlreadyExistsException') {
              ok(`Receipt rule pigeons-${slug} already exists`)
            } else {
              fail(`Receipt rule: ${err.message}`)
              failures.push('SES receipt rule — requires ses:CreateReceiptRule permission')
            }
          }
        }
      }

      // 13. Print DNS records
      if (dkimTokens.length > 0) {
        console.log('\n  ─── DNS Records ───\n')
        console.log('  Add these records to your DNS provider:\n')

        for (const token of dkimTokens) {
          console.log(`  CNAME  ${token}._domainkey.${domain}`)
          console.log(`         ${token}.dkim.amazonses.com\n`)
        }

        console.log(`  TXT    mail.${domain}`)
        console.log(`         "v=spf1 include:amazonses.com ~all"\n`)

        console.log(`  MX     mail.${domain}`)
        console.log(`         10 feedback-smtp.${region}.amazonses.com\n`)

        if (!opts.skipInbound) {
          console.log(`  MX     ${domain}`)
          console.log(`         10 inbound-smtp.${region}.amazonaws.com\n`)
        }

        console.log(`  TXT    _dmarc.${domain}`)
        console.log(`         "v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}"\n`)
      }

      // 14. Print env vars
      console.log('  ─── Environment Variables ───\n')
      console.log('  Add these to your .env or Docker config:\n')
      console.log(`  PIGEONS_AWS_ACCESS_KEY_ID=${accessKeyId}`)
      console.log(`  PIGEONS_AWS_SECRET_ACCESS_KEY=${secretAccessKey}`)
      console.log(`  PIGEONS_AWS_REGION=${region}`)
      console.log(`  PIGEONS_FROM_EMAIL=noreply@${domain}`)
      console.log(`  PIGEONS_CONFIGURATION_SET=${configSetName}`)
      if (bucketName) {
        console.log(`  PIGEONS_INBOUND_S3_BUCKET=${bucketName}`)
        console.log(`  PIGEONS_INBOUND_S3_KEY_PREFIX=inbound/`)
      }
      console.log()

      // 15. Print SNS topic ARNs for subscription
      if (eventsTopicArn || inboundTopicArn) {
        console.log('  ─── SNS Topics ───\n')
        console.log('  After starting your Pigeons server, subscribe these topics')
        console.log('  to your server\'s webhook endpoints:\n')
        if (eventsTopicArn) {
          console.log(`  Events topic: ${eventsTopicArn}`)
          console.log(`    → POST https://<your-server>/v1/internal/ses/events\n`)
        }
        if (inboundTopicArn) {
          console.log(`  Inbound topic: ${inboundTopicArn}`)
          console.log(`    → POST https://<your-server>/v1/internal/ses/inbound\n`)
        }
        console.log('  Subscribe with:')
        if (eventsTopicArn) {
          console.log(`    aws sns subscribe --topic-arn ${eventsTopicArn} \\`)
          console.log('      --protocol https --endpoint https://<your-server>/v1/internal/ses/events')
        }
        if (inboundTopicArn) {
          console.log(`    aws sns subscribe --topic-arn ${inboundTopicArn} \\`)
          console.log('      --protocol https --endpoint https://<your-server>/v1/internal/ses/inbound')
        }
        console.log()
      }

      // 16. Print failures
      if (failures.length > 0) {
        console.log('  ─── Manual Steps Required ───\n')
        console.log('  The following steps failed (likely due to IAM permissions):\n')
        for (const f of failures) {
          console.log(`    • ${f}`)
        }
        console.log('\n  Grant the missing permissions and re-run `pigeons setup aws`.')
        console.log('  Already-created resources will be detected and skipped.\n')
      } else {
        console.log('  Setup complete.\n')
      }
    } catch (err: any) {
      console.error(`\n  Error: ${err.message ?? err}`)
      if (err.Code || err.$metadata) {
        console.error(`  AWS Error: ${err.Code ?? err.name}`)
      }
      process.exit(1)
    } finally {
      rl.close()
    }
  })

function step(msg: string) {
  process.stdout.write(`  … ${msg}`)
}

function ok(msg: string) {
  process.stdout.write(`\r  ✓ ${msg}\n`)
}

function warn(msg: string) {
  process.stdout.write(`\r  ⚠ ${msg}\n`)
}

function fail(msg: string) {
  process.stdout.write(`\r  ✗ ${msg}\n`)
}
