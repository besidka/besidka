import {
  MCP_IDENTITY_SCOPES,
  MCP_READ_SCOPES,
  MCP_WRITE_SCOPES,
} from '#shared/utils/mcp-oauth-scopes'

const MCP_ENDPOINT_PATH = '/mcp'
const REGISTRATION_ENDPOINT_PATH = '/api/auth/oauth2/register'
const AUTHORIZATION_SERVER_METADATA_PATH
  = '/.well-known/oauth-authorization-server'
const OPENID_CONFIGURATION_PATH = '/.well-known/openid-configuration'
const PROTECTED_RESOURCE_METADATA_PATH
  = `/.well-known/oauth-protected-resource${MCP_ENDPOINT_PATH}`
const SERVER_CARD_PATH = '/.well-known/mcp/server-card.json'

function formatScopes(scopes: readonly string[]): string {
  return scopes.map((scope) => {
    return `\`${scope}\``
  }).join(', ')
}

export function buildAuthMd(origin: string): string {
  return `# Besidka auth.md

Besidka does not implement agentic registration. An agent cannot create a Besidka account, register itself as a user, get an anonymous identity, or exchange an ID-JAG for a credential. There is no \`agent_auth\` block in the authorization server metadata and no \`/agent/identity\` endpoint. This file exists so that an agent does not look for them.

An agent can act only for a person who already has a Besidka account and who signs in and consents. Access is standard OAuth 2.1: authorization code with PKCE (S256), after dynamic client registration.

## Audience

Agents that act on behalf of an existing signed-in Besidka user, through the MCP server at ${origin}${MCP_ENDPOINT_PATH}. Without a token the server still answers its public read-only tools (models, providers, key guides, public pages). Per-user tools need a token.

## Discover

1. Call a per-user tool at ${origin}${MCP_ENDPOINT_PATH} without a token. The server answers \`401\` with a \`WWW-Authenticate: Bearer resource_metadata="..."\` header.
2. Fetch the protected resource metadata: ${origin}${PROTECTED_RESOURCE_METADATA_PATH}
3. Fetch the authorization server metadata from the issuer it names: ${origin}${AUTHORIZATION_SERVER_METADATA_PATH} (also served as ${origin}${OPENID_CONFIGURATION_PATH}).
4. Read \`registration_endpoint\`, \`authorization_endpoint\`, \`token_endpoint\`, \`revocation_endpoint\` and \`scopes_supported\` from that metadata instead of hardcoding them.

The MCP server card, ${origin}${SERVER_CARD_PATH}, lists the protected resource metadata URL too.

## Register a client

Besidka supports dynamic client registration (RFC 7591) at ${origin}${REGISTRATION_ENDPOINT_PATH}. This registers an OAuth client application. It does not create a user and it grants no access by itself. Send a normal client registration request with your redirect URIs. Besidka accepts the registration without a user session, and the user's consent is what gates every token.

## Authorize

1. Start an authorization code flow with PKCE, using \`code_challenge_method=S256\`.
2. Send the user to the \`authorization_endpoint\`. If the user is not signed in, Besidka shows its normal sign-in page first. Agents never receive or handle the user's password.
3. Besidka shows a consent page at ${origin}/oauth/consent where the user approves or refuses the request.
4. Exchange the returned code at the \`token_endpoint\` with your \`code_verifier\`.

## Scopes

- Identity: ${formatScopes(MCP_IDENTITY_SCOPES)}. \`offline_access\` asks for a refresh token.
- Read: ${formatScopes(MCP_READ_SCOPES)}
- Write: ${formatScopes(MCP_WRITE_SCOPES)}

\`data:delete\` is the only scope that permits permanent deletion of chats, messages, projects, knowledge, files and memory. Ask for it only when the task deletes data.

Ask for the fewest scopes the task needs. A token covers only the scopes the user approved.

## Use the token

Send \`Authorization: Bearer <access_token>\` on requests to ${origin}${MCP_ENDPOINT_PATH}. After a \`401\`, refresh the token or ask the user to authorize again.

## Revoke

Revoke a token at the \`revocation_endpoint\` in the authorization server metadata (RFC 7009). When a token is revoked or expires, the per-user tools stop answering with it and the public tools keep working.

## What is not supported

- Agent self-registration of any kind, including anonymous, verified-email and ID-JAG registration.
- The \`urn:ietf:params:oauth:grant-type:jwt-bearer\` and claim grants of the auth.md profile.
- API keys or long-lived personal access tokens for agents.
- Any access to a user's data without that user's consent.
`
}
