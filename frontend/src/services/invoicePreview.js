import { pdfErrorMessage } from './invoicePdf.js'

export function createInvoicePreview(fetchPdf, update) {
  let owner = null
  const release = () => {
    owner?.controller.abort()
    if (owner?.url) URL.revokeObjectURL(owner.url)
    owner = null
  }
  return {
    dispose: release,
    close() { release(); update(null) },
    async open(invoice) {
      release()
      const request = { controller: new AbortController(), url: null }
      owner = request
      update({ invoice, url: null, loading: true, error: '' })
      try {
        if (!invoice.id || /^\d+$/.test(String(invoice.id))) throw new Error('Preview is not available for this invoice.')
        const response = await fetchPdf(invoice.id, request.controller.signal)
        if (owner !== request) return
        request.url = URL.createObjectURL(response.data)
        update({ invoice, url: request.url, loading: false, error: '' })
      } catch (error) {
        if (owner !== request || request.controller.signal.aborted) return
        update({ invoice, url: null, loading: false, error: pdfErrorMessage(error) })
      }
    },
  }
}
