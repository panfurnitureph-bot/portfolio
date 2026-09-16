/* The signed-in demo account for the Northwind Motor Parts console (matches the production admin seat). */
export const DEMO_PROFILE = {
  id: 'demo-devops',
  email: 'admin@northwindparts.example',
  full_name: 'Dev Ops',
  role: 'admin',
  status: 'approved',
  country: null,
  countries: null,
  factories: null,
  created_at: '2025-01-06T08:00:00.000Z',
  avatar_url: null,
  last_mfa_verified_at: new Date().toISOString(),
}

export const DEMO_USER = {
  id: DEMO_PROFILE.id,
  email: DEMO_PROFILE.email,
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: { provider: 'email' },
  user_metadata: { full_name: DEMO_PROFILE.full_name },
  created_at: DEMO_PROFILE.created_at,
}

export const DEMO_SESSION = {
  access_token: 'demo-access-token',
  refresh_token: 'demo-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: DEMO_USER,
}
