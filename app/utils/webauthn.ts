export function browserSupportsWebAuthn(): boolean {
  return typeof PublicKeyCredential !== 'undefined'
}

export async function browserSupportsWebAuthnAutofill(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) {
    return false
  }

  const publicKeyCredential = PublicKeyCredential as unknown as {
    isConditionalMediationAvailable?: () => Promise<boolean>
  }

  const isConditionalMediationAvailable
    = publicKeyCredential.isConditionalMediationAvailable

  if (typeof isConditionalMediationAvailable !== 'function') {
    return false
  }

  return isConditionalMediationAvailable()
}

const passkeyCeremonyCancelledCodes = [
  'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
  'ERROR_CEREMONY_ABORTED',
]

export function isPasskeyCeremonyCancelled(code?: string): boolean {
  return !!code && passkeyCeremonyCancelledCodes.includes(code)
}
