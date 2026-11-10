import {
  ARTIFACT_KINDS,
  METHODS,
  PROTOCOL_VERSION,
  connectRuntime,
} from '@besidka/artifacts-protocol'
import type {
  ArtifactPayload,
  RuntimeConnection,
} from '@besidka/artifacts-protocol'
import {
  changeTheme,
  installDocumentHooks,
  renderArtifact,
  renderPartial,
  setRenderedNotifier,
} from './artifact.ts'
import { createBesidkaApi, installBesidkaApi } from './bridge.ts'
import { defineKitElements } from './kit/elements.ts'
import { setHostActionConnection } from './kit/host-actions.ts'
import { installLinkInterception } from './links.ts'
import { reportError, setHostNotifier } from './report.ts'
import { ROOT_ELEMENT_ID } from './shell.ts'
import { startSizeReporting } from './size.ts'
import { disableWebRtc } from './webrtc.ts'

const STANDALONE_MESSAGE = 'This page renders Besidka artifacts inside the Besidka app. It does nothing on its own.'

let initialized = false
let pendingResult: ArtifactPayload | null = null
let pendingPartial: ArtifactPayload | null = null

function showStandaloneNotice() {
  const root = document.getElementById(ROOT_ELEMENT_ID)

  if (!root) {
    return
  }

  const notice = document.createElement('p')

  notice.className = 'besidka-standalone'
  notice.textContent = STANDALONE_MESSAGE
  root.replaceChildren(notice)
}

function handleToolResult(payload: ArtifactPayload) {
  if (!initialized) {
    pendingResult = payload
    pendingPartial = null

    return
  }

  renderArtifact(payload)
}

function handleToolInputPartial(payload: ArtifactPayload) {
  if (!initialized) {
    pendingPartial = payload

    return
  }

  renderPartial(payload)
}

function openLinkThroughHost(connection: RuntimeConnection, url: string) {
  connection.request(METHODS.openLink, { url }).catch((exception) => {
    reportError(exception, { level: 'warning', showPanel: false })
  })
}

function flushPendingContent() {
  if (pendingResult) {
    renderArtifact(pendingResult)
  } else if (pendingPartial) {
    renderPartial(pendingPartial)
  }

  pendingResult = null
  pendingPartial = null
}

async function boot() {
  if (window.parent === window) {
    showStandaloneNotice()

    return
  }

  disableWebRtc()
  defineKitElements()
  installDocumentHooks()

  const connection = await connectRuntime({
    handlers: {
      onToolResult: (params) => {
        handleToolResult(params.structuredContent)
      },
      onToolInputPartial: (params) => {
        handleToolInputPartial(params.arguments)
      },
      onHostContextChanged: (params) => {
        if (params.theme) {
          changeTheme(params.theme)
        }
      },
    },
  })

  setHostNotifier((params) => {
    connection.notify(METHODS.message, params)
  })
  setRenderedNotifier((params) => {
    connection.notify(METHODS.rendered, params)
  })
  setHostActionConnection(connection)
  installLinkInterception((url) => {
    openLinkThroughHost(connection, url)
  })

  try {
    const { hostContext, protocolVersion } = await connection.request(
      METHODS.initialize,
      {
        protocolVersion: PROTOCOL_VERSION,
        appCapabilities: { kinds: [...ARTIFACT_KINDS], rendered: true },
      },
    )

    if (protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`The host speaks protocol ${protocolVersion}, this runtime speaks ${PROTOCOL_VERSION}.`)
    }

    changeTheme(hostContext.theme)
    installBesidkaApi(createBesidkaApi(connection, hostContext.capabilities))
    startSizeReporting((height) => {
      connection.notify(METHODS.sizeChanged, { height })
    })
    initialized = true
    connection.notify(METHODS.initialized, {})
    flushPendingContent()
  } catch (exception) {
    reportError(exception)
  }
}

boot()
