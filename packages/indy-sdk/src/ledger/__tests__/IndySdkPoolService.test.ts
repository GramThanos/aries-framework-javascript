import type { IndySdkPoolConfig } from '../IndySdkPool'
import type { CachedDidResponse } from '../IndySdkPoolService'
import type { AgentContext } from '@aries-framework/core'

import { SigningProviderRegistry, AriesFrameworkError } from '@aries-framework/core'
import { Subject } from 'rxjs'

import { CacheRecord } from '../../../../core/src/cache'
import { CacheRepository } from '../../../../core/src/cache/CacheRepository'
import { getDidResponsesForDid } from '../../../../core/src/modules/ledger/__tests__/didResponses'
import { agentDependencies, getAgentConfig, getAgentContext, mockFunction } from '../../../../core/tests/helpers'
import { NodeFileSystem } from '../../../../node/src/NodeFileSystem'
import { IndySdkWallet } from '../../wallet/IndySdkWallet'
import { INDY_SDK_DID_POOL_CACHE_ID, IndySdkPoolService } from '../IndySdkPoolService'
import { IndySdkPoolError, IndySdkPoolNotConfiguredError, IndySdkPoolNotFoundError } from '../error'

jest.mock('../../../../core/src/cache/CacheRepository')
const CacheRepositoryMock = CacheRepository as jest.Mock<CacheRepository>

const pools: IndySdkPoolConfig[] = [
  {
    id: 'sovrinMain',
    indyNamespace: 'sovrin',
    isProduction: true,
    genesisTransactions: 'xxx',
    transactionAuthorAgreement: { version: '1', acceptanceMechanism: 'accept' },
  },
  {
    id: 'sovrinBuilder',
    indyNamespace: 'sovrin:builder',
    isProduction: false,
    genesisTransactions: 'xxx',
    transactionAuthorAgreement: { version: '1', acceptanceMechanism: 'accept' },
  },
  {
    id: 'sovringStaging',
    indyNamespace: 'sovrin:staging',
    isProduction: false,
    genesisTransactions: 'xxx',
    transactionAuthorAgreement: { version: '1', acceptanceMechanism: 'accept' },
  },
  {
    id: 'indicioMain',
    indyNamespace: 'indicio',
    isProduction: true,
    genesisTransactions: 'xxx',
    transactionAuthorAgreement: { version: '1', acceptanceMechanism: 'accept' },
  },
  {
    id: 'bcovrinTest',
    indyNamespace: 'bcovrin:test',
    isProduction: false,
    genesisTransactions: 'xxx',
    transactionAuthorAgreement: { version: '1', acceptanceMechanism: 'accept' },
  },
]

describe('IndySdkPoolService', () => {
  const config = getAgentConfig('IndySdkPoolServiceTest', {
    indyLedgers: pools,
  })
  let agentContext: AgentContext
  let wallet: IndySdkWallet
  let poolService: IndySdkPoolService
  let cacheRepository: CacheRepository

  beforeAll(async () => {
    wallet = new IndySdkWallet(config.agentDependencies.indy, config.logger, new SigningProviderRegistry([]))
    agentContext = getAgentContext()
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await wallet.createAndOpen(config.walletConfig!)
  })

  afterAll(async () => {
    await wallet.delete()
  })

  beforeEach(async () => {
    cacheRepository = new CacheRepositoryMock()
    mockFunction(cacheRepository.findById).mockResolvedValue(null)

    poolService = new IndySdkPoolService(
      cacheRepository,
      agentDependencies.indy,
      config.logger,
      new Subject<boolean>(),
      new NodeFileSystem()
    )

    poolService.setPools(pools)
  })

  describe('getPoolForDid', () => {
    it('should throw a IndySdkPoolNotConfiguredError error if no pools are configured on the pool service', async () => {
      poolService.setPools([])

      expect(poolService.getPoolForDid(agentContext, 'some-did')).rejects.toThrow(IndySdkPoolNotConfiguredError)
    })

    it('should throw a IndySdkPoolError if all ledger requests throw an error other than NotFoundError', async () => {
      const did = 'Y5bj4SjCiTM9PgeheKAiXx'

      poolService.pools.forEach((pool) => {
        const spy = jest.spyOn(pool, 'submitReadRequest')
        spy.mockImplementationOnce(() => Promise.reject(new AriesFrameworkError('Something went wrong')))
      })

      expect(poolService.getPoolForDid(agentContext, did)).rejects.toThrowError(IndySdkPoolError)
    })

    it('should throw a IndySdkPoolNotFoundError if all pools did not find the did on the ledger', async () => {
      const did = 'Y5bj4SjCiTM9PgeheKAiXx'
      // Not found on any of the ledgers
      const responses = getDidResponsesForDid(did, pools, {})

      poolService.pools.forEach((pool, index) => {
        const spy = jest.spyOn(pool, 'submitReadRequest')
        spy.mockImplementationOnce(responses[index])
      })

      expect(poolService.getPoolForDid(agentContext, did)).rejects.toThrowError(IndySdkPoolNotFoundError)
    })

    it('should return the pool if the did was only found on one ledger', async () => {
      const did = 'TL1EaPFCZ8Si5aUrqScBDt'
      // Only found on one ledger
      const responses = getDidResponsesForDid(did, pools, {
        sovrinMain: '~43X4NhAFqREffK7eWdKgFH',
      })

      poolService.pools.forEach((pool, index) => {
        const spy = jest.spyOn(pool, 'submitReadRequest')
        spy.mockImplementationOnce(responses[index])
      })

      const { pool } = await poolService.getPoolForDid(agentContext, did)

      expect(pool.config.id).toBe('sovrinMain')
    })

    it('should return the first pool with a self certifying DID if at least one did is self certifying ', async () => {
      const did = 'did:sov:q7ATwTYbQDgiigVijUAej'
      // Found on one production and one non production ledger
      const responses = getDidResponsesForDid(did, pools, {
        indicioMain: '~43X4NhAFqREffK7eWdKgFH',
        bcovrinTest: '43X4NhAFqREffK7eWdKgFH43X4NhAFqREffK7eWdKgFH',
        sovrinBuilder: '~43X4NhAFqREffK7eWdKgFH',
      })

      poolService.pools.forEach((pool, index) => {
        const spy = jest.spyOn(pool, 'submitReadRequest')
        spy.mockImplementationOnce(responses[index])
      })

      const { pool } = await poolService.getPoolForDid(agentContext, did)

      expect(pool.config.id).toBe('sovrinBuilder')
    })

    it('should return the production pool if the did was found on one production and one non production ledger and both DIDs are not self certifying', async () => {
      const did = 'V6ty6ttM3EjuCtosH6sGtW'
      // Found on one production and one non production ledger
      const responses = getDidResponsesForDid(did, pools, {
        indicioMain: '43X4NhAFqREffK7eWdKgFH43X4NhAFqREffK7eWdKgFH',
        sovrinBuilder: '43X4NhAFqREffK7eWdKgFH43X4NhAFqREffK7eWdKgFH',
      })

      poolService.pools.forEach((pool, index) => {
        const spy = jest.spyOn(pool, 'submitReadRequest')
        spy.mockImplementationOnce(responses[index])
      })

      const { pool } = await poolService.getPoolForDid(agentContext, did)

      expect(pool.config.id).toBe('indicioMain')
    })

    it('should return the pool with the self certified did if the did was found on two production ledgers where one did is self certified', async () => {
      const did = 'VsKV7grR1BUE29mG2Fm2kX'
      // Found on two production ledgers. Sovrin is self certified
      const responses = getDidResponsesForDid(did, pools, {
        sovrinMain: '~43X4NhAFqREffK7eWdKgFH',
        indicioMain: 'kqa2HyagzfMAq42H5f9u3UMwnSBPQx2QfrSyXbUPxMn',
      })

      poolService.pools.forEach((pool, index) => {
        const spy = jest.spyOn(pool, 'submitReadRequest')
        spy.mockImplementationOnce(responses[index])
      })

      const { pool } = await poolService.getPoolForDid(agentContext, did)

      expect(pool.config.id).toBe('sovrinMain')
    })

    it('should return the first pool with a self certified did if the did was found on three non production ledgers where two DIDs are self certified', async () => {
      const did = 'HEi9QViXNThGQaDsQ3ptcw'
      // Found on two non production ledgers. Sovrin is self certified
      const responses = getDidResponsesForDid(did, pools, {
        sovrinBuilder: '~M9kv2Ez61cur7X39DXWh8W',
        sovrinStaging: '~M9kv2Ez61cur7X39DXWh8W',
        bcovrinTest: '3SeuRm3uYuQDYmHeuMLu1xNHozNTtzS3kbZRFMMCWrX4',
      })

      poolService.pools.forEach((pool, index) => {
        const spy = jest.spyOn(pool, 'submitReadRequest')
        spy.mockImplementationOnce(responses[index])
      })

      const { pool } = await poolService.getPoolForDid(agentContext, did)

      expect(pool.config.id).toBe('sovrinBuilder')
    })

    it('should return the pool from the cache if the did was found in the cache', async () => {
      const did = 'HEi9QViXNThGQaDsQ3ptcw'

      const expectedPool = pools[3]

      const didResponse: CachedDidResponse = {
        nymResponse: {
          did,
          role: 'ENDORSER',
          verkey: '~M9kv2Ez61cur7X39DXWh8W',
        },
        poolId: expectedPool.id,
      }

      const cachedEntries = [
        {
          key: did,
          value: didResponse,
        },
      ]

      mockFunction(cacheRepository.findById).mockResolvedValue(
        new CacheRecord({
          id: INDY_SDK_DID_POOL_CACHE_ID,
          entries: cachedEntries,
        })
      )

      const { pool } = await poolService.getPoolForDid(agentContext, did)

      expect(pool.config.id).toBe(pool.id)
    })

    it('should set the poolId in the cache if the did was not found in the cache, but resolved later on', async () => {
      const did = 'HEi9QViXNThGQaDsQ3ptcw'
      // Found on one ledger
      const responses = getDidResponsesForDid(did, pools, {
        sovrinBuilder: '~M9kv2Ez61cur7X39DXWh8W',
      })

      mockFunction(cacheRepository.findById).mockResolvedValue(
        new CacheRecord({
          id: INDY_SDK_DID_POOL_CACHE_ID,
          entries: [],
        })
      )

      const spy = mockFunction(cacheRepository.update).mockResolvedValue()

      poolService.pools.forEach((pool, index) => {
        const spy = jest.spyOn(pool, 'submitReadRequest')
        spy.mockImplementationOnce(responses[index])
      })

      const { pool } = await poolService.getPoolForDid(agentContext, did)

      expect(pool.config.id).toBe('sovrinBuilder')
      expect(pool.config.indyNamespace).toBe('sovrin:builder')

      const cacheRecord = spy.mock.calls[0][1]
      expect(cacheRecord.entries.length).toBe(1)
      expect(cacheRecord.entries[0].key).toBe(did)
      expect(cacheRecord.entries[0].value).toEqual({
        nymResponse: {
          did,
          verkey: '~M9kv2Ez61cur7X39DXWh8W',
          role: '0',
        },
        poolId: 'sovrinBuilder',
      })
    })
  })

  describe('getPoolForNamespace', () => {
    it('should throw a IndySdkPoolNotConfiguredError error if no pools are configured on the pool service', async () => {
      poolService.setPools([])

      expect(() => poolService.getPoolForNamespace()).toThrow(IndySdkPoolNotConfiguredError)
    })

    it('should return the first pool if indyNamespace is not provided', async () => {
      const expectedPool = pools[0]

      expect(poolService.getPoolForNamespace().id).toEqual(expectedPool.id)
    })

    it('should throw a IndySdkPoolNotFoundError error if any of the pools did not have the provided indyNamespace', async () => {
      const indyNameSpace = 'test'
      const responses = pools.map((pool) => pool.indyNamespace)

      poolService.pools.forEach((pool, index) => {
        const spy = jest.spyOn(pool, 'didIndyNamespace', 'get')
        spy.mockReturnValueOnce(responses[index])
      })

      expect(() => poolService.getPoolForNamespace(indyNameSpace)).toThrow(IndySdkPoolNotFoundError)
    })

    it('should return the first pool that indyNamespace matches', async () => {
      const expectedPool = pools[3]
      const indyNameSpace = 'indicio'
      const responses = pools.map((pool) => pool.indyNamespace)

      poolService.pools.forEach((pool, index) => {
        const spy = jest.spyOn(pool, 'didIndyNamespace', 'get')
        spy.mockReturnValueOnce(responses[index])
      })

      const pool = poolService.getPoolForNamespace(indyNameSpace)

      expect(pool.id).toEqual(expectedPool.id)
    })
  })

  describe('submitWriteRequest', () => {
    it('should throw an error if the config version does not match', async () => {
      const pool = poolService.getPoolForNamespace()

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      jest.spyOn(poolService, 'getTransactionAuthorAgreement').mockResolvedValue({
        digest: 'abcde',
        version: '2.0',
        text: 'jhsdhbv',
        ratification_ts: 12345678,
        acceptanceMechanisms: {
          aml: { accept: 'accept' },
          amlContext: 'accept',
          version: '3',
        },
      } as never)
      await expect(
        poolService.submitWriteRequest(
          agentContext,
          pool,
          {
            reqId: 1668174449192969000,
            identifier: 'BBPoJqRKatdcfLEAFL7exC',
            operation: {
              type: '1',
              dest: 'N8NQHLtCKfPmWMgCSdfa7h',
              verkey: 'GAb4NUvpBcHVCvtP45vTVa5Bp74vFg3iXzdp1Gbd68Wf',
              alias: 'Heinz57',
            },
            protocolVersion: 2,
          },
          'GAb4NUvpBcHVCvtP45vTVa5Bp74vFg3iXzdp1Gbd68Wf'
        )
      ).rejects.toThrowError(
        'Unable to satisfy matching TAA with mechanism "accept" and version "1" in pool.\n Found ["accept"] and version 2.0 in pool.'
      )
    })

    it('should throw an error if the config acceptance mechanism does not match', async () => {
      const pool = poolService.getPoolForNamespace()

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      jest.spyOn(poolService, 'getTransactionAuthorAgreement').mockResolvedValue({
        digest: 'abcde',
        version: '1.0',
        text: 'jhsdhbv',
        ratification_ts: 12345678,
        acceptanceMechanisms: {
          aml: { decline: 'accept' },
          amlContext: 'accept',
          version: '1',
        },
      } as never)
      await expect(
        poolService.submitWriteRequest(
          agentContext,
          pool,
          {
            reqId: 1668174449192969000,
            identifier: 'BBPoJqRKatdcfLEAFL7exC',
            operation: {
              type: '1',
              dest: 'N8NQHLtCKfPmWMgCSdfa7h',
              verkey: 'GAb4NUvpBcHVCvtP45vTVa5Bp74vFg3iXzdp1Gbd68Wf',
              alias: 'Heinz57',
            },
            protocolVersion: 2,
          },
          'GAb4NUvpBcHVCvtP45vTVa5Bp74vFg3iXzdp1Gbd68Wf'
        )
      ).rejects.toThrowError(
        'Unable to satisfy matching TAA with mechanism "accept" and version "1" in pool.\n Found ["decline"] and version 1.0 in pool.'
      )
    })

    it('should throw an error if no config is present', async () => {
      const pool = poolService.getPoolForNamespace()
      pool.authorAgreement = undefined
      pool.config.transactionAuthorAgreement = undefined

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      jest.spyOn(poolService, 'getTransactionAuthorAgreement').mockResolvedValue({
        digest: 'abcde',
        version: '1.0',
        text: 'jhsdhbv',
        ratification_ts: 12345678,
        acceptanceMechanisms: {
          aml: { accept: 'accept' },
          amlContext: 'accept',
          version: '3',
        },
      } as never)
      await expect(
        poolService.submitWriteRequest(
          agentContext,
          pool,
          {
            reqId: 1668174449192969000,
            identifier: 'BBPoJqRKatdcfLEAFL7exC',
            operation: {
              type: '1',
              dest: 'N8NQHLtCKfPmWMgCSdfa7h',
              verkey: 'GAb4NUvpBcHVCvtP45vTVa5Bp74vFg3iXzdp1Gbd68Wf',
              alias: 'Heinz57',
            },
            protocolVersion: 2,
          },
          'GAb4NUvpBcHVCvtP45vTVa5Bp74vFg3iXzdp1Gbd68Wf'
        )
      ).rejects.toThrowError(/Please, specify a transaction author agreement with version and acceptance mechanism/)
    })
  })
})
