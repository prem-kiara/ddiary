/**
 * Search M365 org directory for people matching a query string.
 * Uses Microsoft Graph API /users endpoint.
 *
 * Returns array of: { id, displayName, email, jobTitle, phone }
 *
 * Token-expiry handling:
 *   The MS Graph access token lives ~60 min. If a request returns 401, we
 *   transparently call tryRefreshMsToken() (registered by AuthContext) and
 *   retry the request once. This eliminates the "log out / log in to see org
 *   members" workaround. If the refresh itself fails (no SSO session), we
 *   fall back to the previous silent-empty-array behavior so the UI doesn't
 *   crash — it just shows zero results.
 */

import { tryRefreshMsToken } from './msTokenRefresh';

const MS_TOKEN_KEY = 'ddiary_ms_access_token';
let searchTimeout = null;

/**
 * Read the current token, run `doFetch(token)`, and on a 401 transparently
 * refresh + retry once. `doFetch` MUST be a function (not a Response) because
 * we need to re-run it with the new token after refresh.
 *
 * Returns the Response, or null if no token is available even after refresh.
 */
async function fetchWithRefresh(doFetch) {
  let token = sessionStorage.getItem(MS_TOKEN_KEY);
  if (!token) {
    token = await tryRefreshMsToken();
    if (!token) return null;
  }
  let res = await doFetch(token);
  if (res.status === 401) {
    const newToken = await tryRefreshMsToken();
    if (!newToken) return res; // refresh failed — caller treats as failure
    res = await doFetch(newToken);
  }
  return res;
}

export async function searchOrgPeople(query) {
  if (!query || query.trim().length < 2) return [];

  // Escape single quotes per OData spec (replace ' with '') before embedding in $filter,
  // then percent-encode for the URL. Without this, a query like "O'Brien" would break
  // the OData filter syntax and return a 400 error from Graph API.
  const safeQuery = query.trim().replace(/'/g, "''");
  const encoded = encodeURIComponent(safeQuery);
  const url = `https://graph.microsoft.com/v1.0/users?$filter=startsWith(displayName,'${encoded}') or startsWith(mail,'${encoded}')&$select=id,displayName,mail,jobTitle,mobilePhone,businessPhones&$top=8`;

  try {
    const res = await fetchWithRefresh((token) => fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    }));
    if (!res || !res.ok) return [];

    const data = await res.json();
    return (data.value || []).map(u => ({
      id:          u.id,
      displayName: u.displayName,
      email:       u.mail || '',
      jobTitle:    u.jobTitle || '',
      phone:       (u.businessPhones?.[0]) || u.mobilePhone || '',
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch ALL users from the M365 org directory (paginated — follows @odata.nextLink).
 * Used to auto-populate the Team Members page.
 */
export async function fetchAllOrgUsers() {
  const allUsers = [];
  let url = `https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,jobTitle,mobilePhone,businessPhones,department&$top=100&$orderby=displayName`;

  try {
    while (url) {
      // Capture `url` for the closure since it's reassigned below
      const pageUrl = url;
      const res = await fetchWithRefresh((token) => fetch(pageUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      }));

      if (!res || !res.ok) break;

      const data = await res.json();
      const users = (data.value || []).map(u => ({
        id:          u.id,
        displayName: u.displayName,
        email:       u.mail || '',
        jobTitle:    u.jobTitle || '',
        department:  u.department || '',
        phone:       (u.businessPhones?.[0]) || u.mobilePhone || '',
      }));
      allUsers.push(...users);

      // Follow pagination link if more pages exist (cap at 999 to be safe)
      url = (data['@odata.nextLink'] && allUsers.length < 999) ? data['@odata.nextLink'] : null;
    }
    return allUsers;
  } catch {
    // Return whatever we fetched so far
    return allUsers;
  }
}

/**
 * Debounced version — call this from input onChange handlers.
 * Returns a promise that resolves with results after a short delay.
 */
export function searchOrgPeopleDebounced(query, delay = 300) {
  return new Promise((resolve) => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      const results = await searchOrgPeople(query);
      resolve(results);
    }, delay);
  });
}
