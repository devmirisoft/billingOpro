import { useEffect, useState } from 'react'
import { dataApi } from '../services/api'
import { createInvoicePreview } from '../services/invoicePreview'

export default function useInvoicePreview() {
  const [preview, setPreview] = useState(null)
  const [controller] = useState(() => createInvoicePreview(dataApi.invoicePdf, setPreview))
  useEffect(() => controller.dispose, [controller])
  return { preview, openPreview: controller.open, closePreview: controller.close }
}
