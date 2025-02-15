/**
 * @module api/rpc
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  BeaconState,
  BLSPubkey,
  Bytes32,
  ForkResponse,
  Number64,
  SignedBeaconBlock,
  SyncingStatus,
  ValidatorResponse,
  Uint64
} from "@chainsafe/lodestar-types";
import {IBeaconApi} from "./interface";
import {IBeaconChain} from "../../../chain";
import {IApiOptions} from "../../options";
import {IApiModules} from "../../interface";
import {ApiNamespace} from "../../index";
import EventIterator from "event-iterator";
import {IBeaconDb} from "../../../db/api";

export class BeaconApi implements IBeaconApi {

  public namespace: ApiNamespace;

  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;

  public constructor(opts: Partial<IApiOptions>, modules: IApiModules) {
    this.namespace = ApiNamespace.BEACON;
    this.config = modules.config;
    this.chain = modules.chain;
    this.db = modules.db;
  }

  public async getClientVersion(): Promise<Bytes32> {
    return Buffer.from(`lodestar-${process.env.npm_package_version}`, "utf-8");
  }


  public async getValidator(pubkey: BLSPubkey): Promise<ValidatorResponse|null> {
    const state = await this.chain.getHeadState();
    const index = state.validators.findIndex((v) => {
      return this.config.types.BLSPubkey.equals(pubkey, v.pubkey);
    });
    if(index !==-1) {
      return {
        validator: state.validators[index],
        balance: state.balances[index],
        pubkey: pubkey,
        index
      };
    } else {
      return null;
    }
  }

  public async getFork(): Promise<ForkResponse> {
    const state: BeaconState = await this.chain.getHeadState();
    const networkId: Uint64 = this.chain.networkId;
    const fork = state? state.fork : {
      previousVersion: Buffer.alloc(4),
      currentVersion: Buffer.alloc(4),
      epoch: 0
    };
    return {
      fork,
      chainId: networkId,
      genesisValidatorsRoot: state.genesisValidatorsRoot,
    };
  }

  public async getGenesisTime(): Promise<Number64> {
    const state = await this.chain.getHeadState();
    if(state) {
      return state.genesisTime;
    }
    return 0;
  }

  public async getSyncingStatus(): Promise<boolean | SyncingStatus> {
    // TODO: change this after sync service is implemented
    return false;
  }

  public getBlockStream(): AsyncIterable<SignedBeaconBlock> {
    return new EventIterator<SignedBeaconBlock>((push) => {
      this.chain.on("processedBlock", (block) => {
        push(block);
      });
    });
  }
}
