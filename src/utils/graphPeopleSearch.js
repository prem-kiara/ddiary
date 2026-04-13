/**
 * Search M365 org directory for people matching a query string.
 * Uses Microsoft Graph API /users endpoint.
 *
 * Returns array of: { id, displayName, email, jobTitle, phone }
 */

const MS_TOKEN_KEY = 'ddiary_ms_access_token';
let searchTimeout = null;

export async function searchOrgPeople(query) {
  if (!query || query.trim().length < 2) return [];

  const msToken = sessionStorage.getItem(MS_TOKEN_KEY);
  if (!msToken) return [];

  const encoded = encodeURIComponent(query.trim());

  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users?$filter=startsWith(displayName,'${encoded}') or startsWith(mail,'${encoded}')&$select=id,displayName,mail,jobTitle,mobilePhone,businessPhones&$top=8`,
      {
        headers: { 'Authorization': `Bearer ${msToken}` },
      }
    );

    if (!res.ok) return [];

    const data = await res.json();
    return (data.value || []).map(u => ({
      id:          u.id,
      displayName: u.displayName,
      email:       u.mail || '',
      jobTitle:    u.jobTitle || '',
      phone:       u.mobilePhone || (u.businessPhones?.[0]) || '',
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
  const msToken = sessionStorage.getItem(MS_TOKEN_KEY);
  if (!msToken) return [];

  const allUsers = [];
  let url = `https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,jobTitle,mobilePhone,businessPhones,department&$top=100&$orderby=displayName`;

  try {
    while (url) {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${msToken}` },
      });

      if (!res.ok) break;

      const data = await res.json();
      const users = (data.value || []).map(u => ({
        id:          u.id,
        displayName: u.displayName,
        email:       u.mail || '',
        jobTitle:    u.jobTitle || '',
        department:  u.department || '',
        phone:       u.mobilePhone || (u.businessPhones?.[0]) || '',
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
