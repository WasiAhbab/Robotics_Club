const env = process.env;
const required = [
  'SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN', 'SMTP_HOST',
  'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM_ADDRESS',
];
const missing = required.filter((key) => !env[key]?.trim());
if (missing.length) throw new Error('Missing settings: ' + missing.join(', '));
if (!/^[a-z0-9]{20}$/.test(env.SUPABASE_PROJECT_REF))
  throw new Error('Check the hosted project reference.');
if (!['465', '587', '2525'].includes(env.SMTP_PORT))
  throw new Error('Choose a port supported by your encrypted SMTP relay.');
const endpoint = new URL('/v1/projects/' + env.SUPABASE_PROJECT_REF + '/config/auth', 'https://api.supabase.com');
const response = await fetch(endpoint, {
  method: 'PATCH',
  redirect: 'error',
  signal: AbortSignal.timeout(30000),
  headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    smtp_host: env.SMTP_HOST, smtp_port: env.SMTP_PORT, smtp_user: env.SMTP_USER,
    smtp_pass: env.SMTP_PASS, smtp_admin_email: env.SMTP_FROM_ADDRESS,
    smtp_sender_name: 'RoboHaven Robotics Club', mailer_autoconfirm: false,
    disable_signup: false, external_email_enabled: true,
  }),
});
if (!response.ok) throw new Error('Supabase email configuration failed (HTTP ' + response.status + '). Check the project, token and SMTP settings.');
console.log('Supabase accepted the SMTP configuration. Register a test address to verify delivery.');
