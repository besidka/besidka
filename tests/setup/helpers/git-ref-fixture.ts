export const RECORDED_HEAD_SHA = '2c5958ecac7cee2b583967a2c4981d0f4a75c579'
export const RECORDED_FEATURE_SHA = 'cdfc3fffc7b0b678b170b2c86d32cc03b5fef5ab'
export const RECORDED_TAG_OBJECT_SHA = '544eadc6bf3d226fd7a7a9f0dc5b5bf7ca0675b9'
export const RECORDED_TAG_COMMIT_SHA = '50fbc622fc4ef5163becd7fab6573eac35f8462e'
export const RECORDED_LIGHT_TAG_SHA = '0b496e91ec7ae4428c3ed2eeb4c3a40df431f2cc'

/**
 * Lines of real `git-upload-pack` advertisements recorded on 2026-11-14,
 * trimmed to the interesting ones: the HEAD line with its NUL-separated
 * capabilities and `symref=HEAD:refs/heads/main`, two branches and a pull
 * request ref (anthropics/skills), and an annotated tag with its peeled
 * `^{}` line plus a tag recorded twice (actions/checkout).
 */
export const RECORDED_REF_LINES: string[] = [
  `${RECORDED_HEAD_SHA} HEAD\u0000multi_ack thin-pack side-band side-band-64k ofs-delta shallow deepen-since deepen-not deepen-relative no-progress include-tag multi_ack_detailed allow-tip-sha1-in-want allow-reachable-sha1-in-want no-done symref=HEAD:refs/heads/main filter object-format=sha1 agent=git/github-f351b52fe3d7-Linux\n`,
  `${RECORDED_FEATURE_SHA} refs/heads/cj/claude-api-resync\n`,
  `${RECORDED_HEAD_SHA} refs/heads/main\n`,
  'f5ce30fe5fa486f822065270f7f66b642e770f8a refs/pull/1/head\n',
  `${RECORDED_TAG_OBJECT_SHA} refs/tags/v1\n`,
  `${RECORDED_TAG_COMMIT_SHA} refs/tags/v1^{}\n`,
  `ec3afacf7f605c9fc12c70bc1c9e1708ddb99eca refs/tags/v1.1.0\n`,
  `${RECORDED_LIGHT_TAG_SHA} refs/tags/v1.1.0^{}\n`,
]

export function pktLine(text: string): string {
  return `${(new TextEncoder().encode(text).byteLength + 4)
    .toString(16)
    .padStart(4, '0')}${text}`
}

export function buildRecordedAdvertisement(
  lines: string[] = RECORDED_REF_LINES,
): Uint8Array {
  return new TextEncoder().encode([
    pktLine('# service=git-upload-pack\n'),
    '0000',
    ...lines.map(pktLine),
    '0000',
  ].join(''))
}
