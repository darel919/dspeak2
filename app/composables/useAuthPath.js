import { useRuntimeConfig } from '#app'

export function useAuthPath() {
  const config = useRuntimeConfig()
  return config.public.authPath
}
