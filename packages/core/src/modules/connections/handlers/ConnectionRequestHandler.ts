import type { MessageHandler, MessageHandlerInboundMessage } from '../../../agent/MessageHandler'
import type { DidRepository } from '../../dids/repository'
import type { OutOfBandService } from '../../oob/OutOfBandService'
import type { RoutingService } from '../../routing/services/RoutingService'
import type { ConnectionsModuleConfig } from '../ConnectionsModuleConfig'
import type { ConnectionService } from '../services/ConnectionService'

import { OutboundMessageContext } from '../../../agent/models'
import { AriesFrameworkError } from '../../../error/AriesFrameworkError'
import { ConnectionRequestMessage } from '../messages'

export class ConnectionRequestHandler implements MessageHandler {
  private connectionService: ConnectionService
  private outOfBandService: OutOfBandService
  private routingService: RoutingService
  private didRepository: DidRepository
  private connectionsModuleConfig: ConnectionsModuleConfig
  public supportedMessages = [ConnectionRequestMessage]

  public constructor(
    connectionService: ConnectionService,
    outOfBandService: OutOfBandService,
    routingService: RoutingService,
    didRepository: DidRepository,
    connectionsModuleConfig: ConnectionsModuleConfig
  ) {
    this.connectionService = connectionService
    this.outOfBandService = outOfBandService
    this.routingService = routingService
    this.didRepository = didRepository
    this.connectionsModuleConfig = connectionsModuleConfig
  }

  public async handle(messageContext: MessageHandlerInboundMessage<ConnectionRequestHandler>) {
    const { connection, recipientKey, senderKey } = messageContext

    if (!recipientKey || !senderKey) {
      throw new AriesFrameworkError('Unable to process connection request without senderVerkey or recipientKey')
    }

    const outOfBandRecord = await this.outOfBandService.findCreatedByRecipientKey(
      messageContext.agentContext,
      recipientKey
    )

    if (!outOfBandRecord) {
      throw new AriesFrameworkError(`Out-of-band record for recipient key ${recipientKey.fingerprint} was not found.`)
    }

    if (connection && !outOfBandRecord.reusable) {
      throw new AriesFrameworkError(
        `Connection record for non-reusable out-of-band ${outOfBandRecord.id} already exists.`
      )
    }

    const receivedDidRecord = await this.didRepository.findReceivedDidByRecipientKey(
      messageContext.agentContext,
      senderKey
    )
    if (receivedDidRecord) {
      throw new AriesFrameworkError(`A received did record for sender key ${senderKey.fingerprint} already exists.`)
    }

    const connectionRecord = await this.connectionService.processRequest(messageContext, outOfBandRecord)

    if (connectionRecord?.autoAcceptConnection ?? this.connectionsModuleConfig.autoAcceptConnections) {
      // TODO: Allow rotation of keys used in the invitation for new ones not only when out-of-band is reusable
      const routing = outOfBandRecord.reusable
        ? await this.routingService.getRouting(messageContext.agentContext)
        : undefined

      const { message } = await this.connectionService.createResponse(
        messageContext.agentContext,
        connectionRecord,
        outOfBandRecord,
        routing
      )
      return new OutboundMessageContext(message, {
        agentContext: messageContext.agentContext,
        connection: connectionRecord,
        outOfBand: outOfBandRecord,
      })
    }
  }
}
