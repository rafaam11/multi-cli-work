import type {
  RemoteHostAddInput,
  RemoteHostInfo,
  RemoteHostLink,
  RemoteHostView,
  RemotePairResponse,
} from "../../shared/remote-types";
import type { HostPairing, NewRemoteHost } from "./host-registry";
import { parsePairInput, type PairTarget } from "./pair-host";

export interface RemoteHostsServiceOptions {
  registry: {
    canStore(): boolean;
    list(): Promise<RemoteHostInfo[]>;
    save(input: NewRemoteHost): Promise<RemoteHostInfo>;
    remove(hostId: string): Promise<void>;
    clearToken(hostId: string): Promise<void>;
    setNotify(hostId: string, notify: boolean): Promise<void>;
    /** 토큰이 있는 호스트 전부 — 상태 연결을 붙일 대상. */
    pairings(): Promise<HostPairing[]>;
  };
  windows: {
    open(hostId: string, sessionId?: string): Promise<void>;
    closeHost(hostId: string): void;
  };
  links: {
    sync(hosts: readonly HostPairing[]): void;
    snapshot(hostId: string): { link: RemoteHostLink; awaiting: number };
  };
  pair(target: PairTarget, deviceName: string): Promise<RemotePairResponse>;
  /** 호스트의 기기 목록에 보일 이 PC의 이름. */
  deviceName: string;
  allowLoopback: boolean;
  /** 목록이나 연결 상태가 바뀔 때마다 메인 창에 알린다. */
  announce(hosts: RemoteHostView[]): void;
}

/**
 * 이 PC가 클라이언트로서 다른 PC를 등록·삭제·열고 지켜보는 흐름. 저장은 레지스트리, 창은
 * RemoteWindows, 상태 연결은 HostStatusLinks가 맡고 여기서는 셋을 맞춘다.
 */
export function createRemoteHostsService(options: RemoteHostsServiceOptions) {
  /** 마지막으로 읽은 목록. 알림을 낼지 묻는 쪽은 기다릴 수 없어서(메시지 처리 중) 여기서 본다. */
  let known: RemoteHostInfo[] = [];

  const view = async (): Promise<RemoteHostView[]> => {
    known = await options.registry.list();
    return known.map((host) => ({ ...host, ...options.links.snapshot(host.hostId) }));
  };
  const announce = async () => options.announce(await view());
  // 갱신은 한 번에 하나씩, 요청한 순서대로 한다. 각자 읽고 맞추게 두면 먼저 읽은 쪽이 나중에 끝나
  // 옛 목록으로 덮어쓴다 — 방금 지운 호스트에 다시 붙거나, 방금 추가한 호스트의 연결을 닫는다.
  let relinking: Promise<void> = Promise.resolve();
  const relink = (): Promise<void> => {
    relinking = relinking
      .catch(() => undefined)
      .then(async () => options.links.sync(await options.registry.pairings()));
    return relinking;
  };

  return {
    list: view,

    /** 앱이 뜰 때: 등록해 둔 호스트마다 상태 연결을 붙인다. */
    async start(): Promise<void> {
      await view();
      await relink();
    },

    async add(input: RemoteHostAddInput): Promise<RemoteHostView> {
      // 저장할 수 없는 환경이면 호스트에 기기를 등록시키기 전에 멈춘다.
      if (!options.registry.canStore()) throw new Error("이 환경에서는 토큰을 안전하게 저장할 수 없습니다");
      const target = parsePairInput(input, { allowLoopback: options.allowLoopback });
      const paired = await options.pair(target, options.deviceName);
      const info = await options.registry.save({
        hostId: paired.hostId,
        name: paired.hostName,
        address: target.address,
        deviceId: paired.deviceId,
        token: paired.token,
      });
      // 열려 있던 창과 상태 연결은 옛 토큰을 들고 있다.
      options.windows.closeHost(paired.hostId);
      await relink();
      await announce();
      return { ...info, ...options.links.snapshot(info.hostId) };
    },

    async remove(hostId: string): Promise<void> {
      options.windows.closeHost(hostId);
      await options.registry.remove(hostId);
      await relink();
      await announce();
    },

    open: (hostId: string) => options.windows.open(hostId),

    async setNotify(hostId: string, notify: boolean): Promise<void> {
      await options.registry.setNotify(hostId, notify);
      await announce();
    },

    /** 이 호스트의 알림을 받기로 돼 있는가. 아직 목록을 읽지 않았거나 모르는 호스트면 아니다. */
    notifyEnabled(hostId: string): boolean {
      return known.find((host) => host.hostId === hostId)?.notify ?? false;
    },

    /** 호스트가 토큰을 거절했다 — 원격 창의 브리지나 상태 연결이 알린다. */
    async unpaired(hostId: string): Promise<void> {
      await options.registry.clearToken(hostId);
      options.windows.closeHost(hostId);
      await relink();
      await announce();
    },

    /** 상태 연결의 상태나 대기 수가 바뀌었다. */
    linkChanged: announce,
  };
}
