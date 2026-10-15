// Finish generation before sending headers or bytes to the client.
module.exports = function renderPdf(doc, draw) {
    return new Promise((resolve, reject) => {
        const buffers = []
        doc.on('data', (chunk) => buffers.push(chunk))
        doc.once('end', () => resolve(Buffer.concat(buffers)))
        doc.once('error', reject)
        try {
            draw()
            doc.end()
        } catch (error) {
            doc.destroy(error)
            reject(error)
        }
    })
}
