const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')
const PDFDocument = require('pdfkit')
const app = require('./server')

let server, baseUrl, token
const id = '507f1f77bcf86cd799439011'
const Invoice = mongoose.model('Invoice')
const Settings = mongoose.model('Settings')
const originalFindInvoice = Invoice.findById
const originalFindSettings = Settings.findOne
let currentInvoice, currentSettings

before(async () => {
    Invoice.findById = async () => currentInvoice
    Settings.findOne = async () => currentSettings
    server = await new Promise((resolve) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
    })
    baseUrl = `http://127.0.0.1:${server.address().port}/api/invoices/${id}/pdf`
    token = jwt.sign({ id }, process.env.JWT_SECRET || 'development-secret')
})
after(async () => {
    Invoice.findById = originalFindInvoice
    Settings.findOne = originalFindSettings
    if (server) await new Promise((resolve) => server.close(resolve))
})
const request = () => fetch(baseUrl, { headers: { Authorization: `Bearer ${token}` } })
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='

for (const count of [1, 40]) {
    test(`invoice endpoint returns complete PDF for ${count} items with logo and QR`, async () => {
        currentInvoice = {
            invoiceNumber: 'INV/2026/1', customer: { name: 'Test Customer', state: 'Maharashtra' },
            invoiceDate: '2026-10-15', grandTotal: count * 118,
            items: Array.from({ length: count }, () => ({ productName: 'Test item', hsnCode: '1234', quantity: 1, price: 100, gstRate: 18, taxableAmount: 100, cgstAmount: 9, sgstAmount: 9 })),
        }
        currentSettings = { businessName: 'Test Business', state: 'Maharashtra', logoDataUrl: image, qrDataUrl: image }
        const response = await request()
        assert.equal(response.status, 200)
        assert.match(response.headers.get('content-type'), /application\/pdf/)
        assert.match(response.headers.get('content-disposition'), /Invoice-INV_2026_1.pdf/)
        const bytes = Buffer.from(await response.arrayBuffer())
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
        assert.match(bytes.toString(), /%%EOF\s*$/)
        const pages = (bytes.toString().match(/\/Type \/Page\b/g) || []).length
        assert.ok(count === 1 ? pages === 1 : pages > 1)
    })
}

test('unauthenticated and missing invoices return JSON errors', async () => {
    assert.equal((await fetch(baseUrl)).status, 401)
    const invalid = await fetch(baseUrl.replace(id, 'invalid'), { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(invalid.status, 400)
    currentInvoice = null
    const response = await request()
    assert.equal(response.status, 404)
    assert.equal((await response.json()).message, 'Invoice not found')
})

test('rendering exception returns JSON 500 without partial PDF bytes', async () => {
    currentInvoice = { invoiceNumber: 'INV-1', items: [] }
    currentSettings = {}
    const originalText = PDFDocument.prototype.text
    PDFDocument.prototype.text = () => { throw new Error('Simulated rendering failure') }
    try {
        const response = await request()
        assert.equal(response.status, 500)
        assert.match(response.headers.get('content-type'), /application\/json/)
        assert.equal((await response.json()).message, 'Something went wrong. Please try again.')
    } finally {
        PDFDocument.prototype.text = originalText
    }
})
