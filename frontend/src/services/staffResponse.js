const object = value => !!value && typeof value === 'object' && !Array.isArray(value);

// These reports are dereferenced by several dashboard pages. A 200 response with
// missing sections must become a retryable error rather than crash the panel.
export function validateStaffResponse(path, data) {
  const route = path.split('?')[0];
  let valid = object(data);
  if (route === '/api/admin/me') {
    valid = valid && object(data.user) && typeof data.user.id === 'string'
      && object(data.staff) && typeof data.staff.role === 'string'
      && Array.isArray(data.staff.permissions) && data.staff.permissions.every(p => typeof p === 'string');
  } else if (route === '/api/admin/analytics') {
    valid = valid && object(data.range) && Number.isFinite(data.range.from)
      && Number.isFinite(data.range.to) && object(data.totals) && object(data.conversion);
  } else if (route === '/api/admin/developer/health') {
    valid = valid && object(data.db) && object(data.payments) && object(data.outbox);
  }
  if (!valid) throw Object.assign(new Error('The server returned an incomplete staff report. Please try again.'), {
    status: 502, code: 'invalid_response', body: {},
  });
  return data;
}
