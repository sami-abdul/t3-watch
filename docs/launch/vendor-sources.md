# Vendor checks added in 0.6.0

Checked against the vendors' public documentation on 24 October 2026. Each description makes one
GET request, at most once per hour by default. These checks prove that the key can read the named
endpoint. They do not prove that a deployment, database or email delivery works.

Tests use synthetic fixtures and make no calls with real vendor keys. A 401 or 403 means the key
was rejected or lacks the required permission. A rate limit, redirect or server error is unknown.
The engine never follows a redirect with the key.

| Vendor | GET and authentication | Required access and limits | Public documentation |
| --- | --- | --- | --- |
| Vercel | `https://api.vercel.com/v2/user`, Bearer token | Access token that can read its user. No team ID needed. | [Get the User](https://vercel.com/docs/rest-api/user/get-the-user), [tokens](https://vercel.com/docs/rest-api) |
| Cloudflare | `https://api.cloudflare.com/client/v4/user`, Bearer user API token | User Details Read. Global API keys need an email and are not supported; account-owned tokens cannot read a user. A deployment token without this user permission will fail this check. | [User Details and permissions](https://developers.cloudflare.com/api/resources/user/methods/get/), [token authentication](https://developers.cloudflare.com/fundamentals/api/get-started/) |
| Neon | `https://console.neon.tech/api/v2/users/me/organizations`, Bearer API key | Personal, organization or project-scoped API key. No organization ID needed; organization and project keys return their owning organization. A database password is not an API key. | [Current-user organizations](https://api-docs.neon.tech/reference/getcurrentuserorganizations), [API keys](https://neon.com/docs/manage/api-keys) |
| Supabase | `https://api.supabase.com/v1/projects`, Bearer management token | Fine-grained `projects_read`, or a personal access token that can list projects. Project anon, publishable, service-role and secret keys are not Management API tokens and are never scanned as such. | [List projects and permissions](https://supabase.com/docs/reference/api/v1-list-all-projects), [Management API authentication](https://supabase.com/docs/reference/api/introduction) |
| Render | `https://api.render.com/v1/services?limit=1`, Bearer API key | Key from Account Settings with access to list services. An empty list is valid. This key can make changes, so setup warns about it. | [List services](https://api-docs.render.com/reference/list-services), [API setup](https://render.com/docs/api) |
| SendGrid | `https://api.sendgrid.com/v3/scopes`, Bearer API key | Reads the scopes of the supplied key without sending email or requiring access to other keys. This description uses the global endpoint; EU regional subusers need a local description using `api.eu.sendgrid.com`. | [Read this key's scopes](https://www.twilio.com/docs/sendgrid/api-reference/api-key-permissions/retrieve-a-list-of-scopes-for-which-this-user-has-access) |
| Resend | `https://api.resend.com/domains`, Bearer API key | `full_access` is required. Sending-only keys cannot list domains. Setup warns that this key can make changes; Watch still sends only GET. An empty domain list is valid. | [List domains](https://resend.com/docs/api-reference/domains/list-domains), [key permissions](https://resend.com/docs/api-reference/api-keys/create-api-key) |
| GitLab.com | `https://gitlab.com/api/v4/user`, `PRIVATE-TOKEN` header | Personal token with `read_user`. Deploy tokens are unsupported. Self-managed GitLab needs a local description with its own origin. This verifies the key; it adds no GitLab CI runner. | [Current user](https://docs.gitlab.com/api/users/#retrieve-the-current-user), [authentication](https://docs.gitlab.com/api/rest/authentication/), [scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/) |
| DigitalOcean | `https://api.digitalocean.com/v2/account`, Bearer personal access token | `account:read` only. No droplet, billing or write permission needed. A Spaces key is not a control-plane token. | [Account endpoint](https://docs.digitalocean.com/reference/api/reference/account/), [account:read](https://docs.digitalocean.com/reference/api/scopes/account/read/) |

## Two suggested vendors that do not fit yet

Twilio documents Basic authentication with an API key SID and API key secret, or an Account SID
and Auth Token. Watch's current Basic mode sends one key as the username with an empty password.
A Twilio description alone cannot work. It needs paired credential storage and authentication
first. See [Twilio's request and authentication documentation](https://www.twilio.com/docs/usage/requests-to-twilio).

Linear documents GraphQL requests through POST, including read queries. Watch's vendor engine
permits only GET. No documented GET key check was found, so Linear needs a separately scoped
read-only GraphQL design before it can join the catalog. See [Linear's API guide](https://linear.app/developers/graphql).

GitLab and DigitalOcean provide two additional widely used APIs that fit the current engine.
Neither Twilio nor Linear appears as supported in the catalog or page.
