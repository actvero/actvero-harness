/** Local unsigned ACTVERO packages; the official signed release entry is independent. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createActveroElectronBuilderConfig } from './scripts/actvero-electron-builder.mjs'
const directory = process.env.ACTVERO_BRANDING_DIRECTORY
if (!directory) throw new Error('ACTVERO package: run pnpm run actvero:package')
const product = JSON.parse(readFileSync(join(directory, 'build-product.json'), 'utf8'))
export default createActveroElectronBuilderConfig(product, directory)
