import { validateRuntimeEnvironment } from '../utils/env-validation'

export default defineNitroPlugin(() => {
  validateRuntimeEnvironment()
})
