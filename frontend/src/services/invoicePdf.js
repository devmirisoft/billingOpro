export async function validatePdf(blob) {
  if (!(blob instanceof Blob) || !blob.size || await blob.slice(0, 5).text() !== '%PDF-') {
    throw new Error('The server did not return a valid PDF. Please try again.')
  }
  return blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
}

export function pdfErrorMessage(error) {
  const status = error.response?.status
  if (status === 401 || status === 403) return 'Your session has expired or access was denied. Please sign in again.'
  if (status === 404) return 'This invoice could not be found. Refresh the bills list.'
  if (status >= 500) return 'The server could not generate this PDF. Please try again.'
  if (error.code === 'ECONNABORTED') return 'The PDF request timed out. Please try again.'
  if (error.request && !error.response) return 'Could not connect to the server. Check your connection and try again.'
  return error.message || 'Could not open the invoice. Please try again.'
}
