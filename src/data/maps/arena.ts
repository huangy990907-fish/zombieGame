/** 默认地图「竞技场」—— 一间封闭房间，左墙有门、上下墙各有一扇窗。 */
import type { MapDef, Rect, OpeningDef } from "../types";

/** 逻辑画布尺寸（CSS 会等比缩放，不影响游戏逻辑） */
const WIDTH = 1180;
const HEIGHT = 720;

/** 封闭房间矩形，丧尸从门 / 窗三个开口涌入 */
const ROOM = { left: 220, top: 64, right: 1140, bottom: 656, wall: 12 };

/** 左墙上门开口的纵向范围（高 80px，有血量，能挡一阵子） */
const DOOR_RANGE = { y0: 356, y1: 436 };
/**
 * 窗净宽 18px：介于普通（11）/ 狂奔（9）与胖子（22）之间，
 * 前两者能钻窗、胖子按通用体型规则钻不过去。中心仍保持 680 / 720。
 */
/** 上墙窗开口的横向范围（血量很低但能观察 + 射击） */
const WIN_TOP = { x0: 671, x1: 689 };
/** 下墙窗开口的横向范围 */
const WIN_BOTTOM = { x0: 711, x1: 729 };

/**
 * 四面墙，按门窗开口拆成分段：
 *  - 上墙 / 下墙各被一扇窗断开成两段
 *  - 左墙被门断开成两段，右墙完整
 */
const WALLS: Rect[] = [
  // 上墙（中间是窗）
  { x: ROOM.left, y: ROOM.top, w: WIN_TOP.x0 - ROOM.left, h: ROOM.wall },
  { x: WIN_TOP.x1, y: ROOM.top, w: ROOM.right - ROOM.wall - WIN_TOP.x1, h: ROOM.wall },
  // 下墙（中间是窗）
  { x: ROOM.left, y: ROOM.bottom - ROOM.wall, w: WIN_BOTTOM.x0 - ROOM.left, h: ROOM.wall },
  {
    x: WIN_BOTTOM.x1,
    y: ROOM.bottom - ROOM.wall,
    w: ROOM.right - ROOM.wall - WIN_BOTTOM.x1,
    h: ROOM.wall,
  },
  // 右墙
  { x: ROOM.right - ROOM.wall, y: ROOM.top, w: ROOM.wall, h: ROOM.bottom - ROOM.top },
  // 左墙（中间是门）
  { x: ROOM.left, y: ROOM.top, w: ROOM.wall, h: DOOR_RANGE.y0 - ROOM.top },
  { x: ROOM.left, y: DOOR_RANGE.y1, w: ROOM.wall, h: ROOM.bottom - ROOM.wall - DOOR_RANGE.y1 },
];

/** 三个可破坏开口：下标 0 必须是门（分岗逻辑依赖这个顺序） */
const OPENINGS: OpeningDef[] = [
  {
    kind: "door",
    rect: { x: ROOM.left, y: DOOR_RANGE.y0, w: ROOM.wall, h: DOOR_RANGE.y1 - DOOR_RANGE.y0 },
    maxHp: 450,
    passSpeed: 1,
  },
  {
    kind: "window",
    rect: { x: WIN_TOP.x0, y: ROOM.top, w: WIN_TOP.x1 - WIN_TOP.x0, h: ROOM.wall },
    maxHp: 100,
    passSpeed: 0.45,
  },
  {
    kind: "window",
    rect: { x: WIN_BOTTOM.x0, y: ROOM.bottom - ROOM.wall, w: WIN_BOTTOM.x1 - WIN_BOTTOM.x0, h: ROOM.wall },
    maxHp: 100,
    passSpeed: 0.45,
  },
];

export const arena: MapDef = {
  id: "arena",
  name: "竞技场",
  width: WIDTH,
  height: HEIGHT,
  room: ROOM,
  walls: WALLS,
  openings: OPENINGS,
  openingCenters: OPENINGS.map((o) => ({
    x: o.rect.x + o.rect.w * 0.5,
    y: o.rect.y + o.rect.h * 0.5,
  })),
  spawn: { x0: 4, x1: 110, y0: 30, y1: 700 },
  windowSpawn: {
    top: { x0: 360, x1: 1000, y0: 6, y1: 52 },
    bottom: { x0: 360, x1: 1000, y0: 668, y1: 714 },
  },
  humanBounds: {
    x0: ROOM.left + ROOM.wall + 20,
    x1: ROOM.right - ROOM.wall - 20,
    y0: ROOM.top + ROOM.wall + 20,
    y1: ROOM.bottom - ROOM.wall - 20,
  },
  buildBiteDamage: 4,
  buildBiteSlow: 1.5,
};
