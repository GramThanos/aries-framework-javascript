import { getAgentOptions } from '../packages/core/tests/helpers'

import { e2eTest } from './e2e-test'

import { Agent, WsOutboundTransport, AutoAcceptCredential, MediatorPickupStrategy } from '@aries-framework/core'
import { WsInboundTransport } from '@aries-framework/node'

const recipientAgentOptions = getAgentOptions('E2E WS Recipient ', {
  autoAcceptCredentials: AutoAcceptCredential.ContentApproved,
  mediatorPickupStrategy: MediatorPickupStrategy.PickUpV1,
})

const mediatorPort = 4000
const mediatorAgentOptions = getAgentOptions('E2E WS Mediator', {
  endpoints: [`ws://localhost:${mediatorPort}`],
  autoAcceptMediationRequests: true,
})

const senderPort = 4001
const senderAgentOptions = getAgentOptions('E2E WS Sender', {
  endpoints: [`ws://localhost:${senderPort}`],
  mediatorPollingInterval: 1000,
  autoAcceptCredentials: AutoAcceptCredential.ContentApproved,
  mediatorPickupStrategy: MediatorPickupStrategy.PickUpV1,
})

describe('E2E WS tests', () => {
  let recipientAgent: Agent
  let mediatorAgent: Agent
  let senderAgent: Agent

  beforeEach(async () => {
    recipientAgent = new Agent(recipientAgentOptions)
    mediatorAgent = new Agent(mediatorAgentOptions)
    senderAgent = new Agent(senderAgentOptions)
  })

  afterEach(async () => {
    await recipientAgent.shutdown()
    await recipientAgent.wallet.delete()
    await mediatorAgent.shutdown()
    await mediatorAgent.wallet.delete()
    await senderAgent.shutdown()
    await senderAgent.wallet.delete()
  })

  test('Full WS flow (connect, request mediation, issue, verify)', async () => {
    // Recipient Setup
    recipientAgent.registerOutboundTransport(new WsOutboundTransport())
    await recipientAgent.initialize()

    // Mediator Setup
    mediatorAgent.registerInboundTransport(new WsInboundTransport({ port: mediatorPort }))
    mediatorAgent.registerOutboundTransport(new WsOutboundTransport())
    await mediatorAgent.initialize()

    // Sender Setup
    senderAgent.registerInboundTransport(new WsInboundTransport({ port: senderPort }))
    senderAgent.registerOutboundTransport(new WsOutboundTransport())
    await senderAgent.initialize()

    await e2eTest({
      mediatorAgent,
      senderAgent,
      recipientAgent,
    })
  })
})
