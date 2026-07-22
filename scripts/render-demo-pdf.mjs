import { writeFileSync } from 'node:fs'
import { generateDemoPdf } from '../src/utils/demoPdf.ts'

const outPath = process.argv[2] || 'bounds-demo.pdf'
const file = await generateDemoPdf()
const buf = Buffer.from(await file.arrayBuffer())
writeFileSync(outPath, buf)
console.log(`Wrote ${buf.byteLength} bytes to ${outPath}`)
