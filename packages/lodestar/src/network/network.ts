/**
 * @module network
 */

import {EventEmitter} from "events";
import LibP2p from "libp2p";
import PeerInfo from "peer-info";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconMetrics} from "../metrics";

import {ReqResp} from "./reqResp";
import {INetworkOptions} from "./options";
import {INetwork, NetworkEventEmitter,} from "./interface";
import {Gossip} from "./gossip/gossip";
import {IGossip, IGossipMessageValidator} from "./gossip/interface";
import {IBeaconChain} from "../chain";
import {MetadataController} from "./metadata";
import {Discv5Discovery, Discv5, ENR} from "@chainsafe/discv5";

interface ILibp2pModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  metrics: IBeaconMetrics;
  validator: IGossipMessageValidator;
  chain: IBeaconChain;
}


export class Libp2pNetwork extends (EventEmitter as { new(): NetworkEventEmitter }) implements INetwork {

  public peerInfo: PeerInfo;
  public reqResp: ReqResp;
  public gossip: IGossip;
  public metadata: MetadataController;

  private opts: INetworkOptions;
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private inited: Promise<void>;
  private logger: ILogger;
  private metrics: IBeaconMetrics;

  public constructor(opts: INetworkOptions, {config, libp2p, logger, metrics, validator, chain}: ILibp2pModules) {
    super();
    this.opts = opts;
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
    // `libp2p` can be a promise as well as a libp2p object
    this.inited = new Promise((resolve) => {
      Promise.resolve(libp2p).then((libp2p) => {
        this.peerInfo = libp2p.peerInfo;
        this.libp2p = libp2p;
        this.reqResp = new ReqResp(opts, {config, libp2p, logger});
        this.gossip = (new Gossip(opts, {config, libp2p, logger, validator, chain})) as unknown as IGossip;
        const enr = opts.discv5 && opts.discv5.enr || undefined;
        this.metadata = new MetadataController({enr}, {config});
        resolve();
      });
    });
  }

  public async start(): Promise<void> {
    await this.inited;
    await this.libp2p.start();
    await this.reqResp.start();
    await this.gossip.start();
    this.libp2p.on("peer:connect", this.emitPeerConnect);
    this.libp2p.on("peer:disconnect", this.emitPeerDisconnect);
    const multiaddresses = this.libp2p.peerInfo.multiaddrs.toArray().map((m) => m.toString()).join(",");
    this.logger.important(`PeerId ${this.libp2p.peerInfo.id.toB58String()}, Multiaddrs ${multiaddresses}`);
  }

  public async stop(): Promise<void> {
    await this.gossip.stop();
    await this.reqResp.stop();
    await this.libp2p.stop();
    this.libp2p.removeListener("peer:connect", this.emitPeerConnect);
    this.libp2p.removeListener("peer:disconnect", this.emitPeerDisconnect);
  }

  public getPeers(): PeerInfo[] {
    const peers =  Array.from(this.libp2p.peerStore.peers.values()).filter(
      (peerInfo) => !!this.getConnection(peerInfo));
    return peers || [];
  }

  public hasPeer(peerInfo: PeerInfo): boolean {
    return !!this.libp2p.registrar.getConnection(peerInfo);
  }

  public getConnection(peer: PeerInfo): LibP2pConnection {
    return this.libp2p.registrar.getConnection(peer);
  }

  public async connect(peerInfo: PeerInfo): Promise<void> {
    await this.libp2p.dial(peerInfo);
  }

  public async disconnect(peerInfo: PeerInfo): Promise<void> {
    await this.libp2p.hangUp(peerInfo);
  }

  // peerIds: peers already have this subnet
  public async connectToNewPeersBySubnet(subnet: number, inPeerIds?: string[]): Promise<number> {
    const peerIds = inPeerIds || [];
    const discovery: Discv5Discovery = this.libp2p._discovery.get("discv5") as Discv5Discovery;
    const discv5: Discv5 = discovery.discv5;
    const peerInfosForSubnet: PeerInfo[] = await Promise.all(
      discv5.kadValues()
        .filter((enr: ENR) => enr.get("attnets"))
        .filter((enr: ENR) => this.config.types.AttestationSubnets.deserialize(enr.get("attnets"))[subnet])
        .map((enr: ENR) => enr.peerId().then((peerId) => {
          const peerInfo = new PeerInfo(peerId);
          peerInfo.multiaddrs.add(enr.multiaddrTCP);
          return peerInfo;
        })));
    const peerInfos = peerInfosForSubnet.filter(peerInfo => !peerIds.includes(peerInfo.id.toB58String()));
    // make sure they still connect to same subnet
    let count = 0;
    for (const peerInfo of peerInfos) {
      // we'll dial thru sendRequest so don't need to do connect(peerInfo) like in the spec
      const metadata = await this.reqResp.metadata(peerInfo);
      if (metadata.attnets[subnet]) {
        count++;
      }
      if (count < 10) {
        // TODO: decide max peers per subnet to connect?
        break;
      }
    }
    this.logger.info(`Connected to ${count} new peers for subnet ${subnet}`);
    return count;
  }

  private emitPeerConnect = (peerInfo: PeerInfo): void => {
    const conn = this.getConnection(peerInfo);
    this.metrics.peers.inc();
    this.logger.verbose("peer connected " + peerInfo.id.toB58String() + " " + conn.stat.direction);
    this.emit("peer:connect", peerInfo, conn.stat.direction);
  };

  private emitPeerDisconnect = (peerInfo: PeerInfo): void => {
    this.logger.verbose("peer disconnected " + peerInfo.id.toB58String());
    this.metrics.peers.dec();
    this.emit("peer:disconnect", peerInfo);
  };

}
