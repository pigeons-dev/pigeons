import { Pigeons } from '@pigeons/pigeons-ts'

// Singleton Pigeons client shared across all API routes.
//
// Reads PIGEONS_URL and PIGEONS_API_KEY from environment variables.
// In production, set these in your deployment platform's env config.
// For local development, copy .env.example to .env.local and fill in
// the values from your running Pigeons instance.
//
// The client is created once at module load time and reused for
// every request — no need to instantiate per-request.
export const pigeons = new Pigeons({
  baseUrl: process.env.PIGEONS_URL,
  apiKey: process.env.PIGEONS_API_KEY,
})
