export const todayStr = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD

export const fmtDate = (d) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString() : ''

export function borrowerLabel(checkout, profiles, userId) {
  if (checkout.borrower_name) return checkout.borrower_name
  if (checkout.borrower_id === userId) return 'you'
  return profiles?.get(checkout.borrower_id) || 'a member'
}