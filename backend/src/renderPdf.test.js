const test = require('node:test')
const assert = require('node:assert/strict')
const PDFDocument = require('pdfkit')
const renderPdf = require('./renderPdf')

for (const pages of [1, 3]) {
    test(`complete ${pages}-page PDF is returned`, async () => {
        const doc = new PDFDocument()
        const bytes = await renderPdf(doc, () => {
            for (let i = 0; i < pages; i++) {
                if (i) doc.addPage()
                doc.text(`Invoice page ${i + 1}`)
            }
        })
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
        assert.match(bytes.toString(), /%%EOF\s*$/)
        assert.equal((bytes.toString().match(/\/Type \/Page\b/g) || []).length, pages)
    })
}

test('synchronous rendering failure rejects instead of returning partial bytes', async () => {
    await assert.rejects(renderPdf(new PDFDocument(), () => { throw new Error('Rendering failed') }), /Rendering failed/)
})

test('stream failure rejects instead of returning partial bytes', async () => {
    const doc = new PDFDocument()
    await assert.rejects(renderPdf(doc, () => { doc.destroy(new Error('Stream failed')) }), /Stream failed/)
})
