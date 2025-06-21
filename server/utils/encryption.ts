import CryptoShield from 'crypto-shield'

let cryptoInstance: CryptoShield | null = null

function getCryptoInstance() {
  if (cryptoInstance) {
    return cryptoInstance
  }

  const { encryptionKey } = useRuntimeConfig(useEvent())

  cryptoInstance = new CryptoShield({
    secretKey: encryptionKey,
  })

  return cryptoInstance
}

export async function useEncryptText(plain: string): Promise<string> {
  const crypto = getCryptoInstance()

  return await crypto.encryptText(plain)
}

export async function useDecryptText(plain: string): Promise<string> {
  const crypto = getCryptoInstance()

  return await crypto.decryptText(plain)
}
