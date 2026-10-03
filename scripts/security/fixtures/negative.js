// Safe controls: runtime configuration, static logging, and parsed data only.
const apiKey = getManagedSecret('APP_API_KEY')
logger.info('provider request completed')
const parsed = JSON.parse(untrustedText)
fetch(configuredHttpsEndpoint, { headers: { authorization: `Bearer ${sessionToken}` } })
if (verifiedMembership.role === 'owner') grantWorkspaceAccess()