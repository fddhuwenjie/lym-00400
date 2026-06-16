const MAX_LEVEL = 32;
const P = 0.25;

class SkipListNode {
  score: number;
  member: string;
  forward: (SkipListNode | null)[];
  backward: SkipListNode | null;

  constructor(score: number, member: string, level: number) {
    this.score = score;
    this.member = member;
    this.forward = new Array(level).fill(null);
    this.backward = null;
  }
}

export class SkipList {
  private head: SkipListNode;
  private tail: SkipListNode | null;
  private length: number;
  private level: number;

  constructor() {
    this.level = 1;
    this.length = 0;
    this.head = new SkipListNode(0, "", MAX_LEVEL);
    this.tail = null;
  }

  private randomLevel(): number {
    let level = 1;
    while (Math.random() < P && level < MAX_LEVEL) {
      level++;
    }
    return level;
  }

  private compare(score1: number, member1: string, score2: number, member2: string): number {
    if (score1 !== score2) {
      return score1 - score2;
    }
    if (member1 === member2) return 0;
    return member1 < member2 ? -1 : 1;
  }

  insert(score: number, member: string): number {
    const update: (SkipListNode | null)[] = new Array(MAX_LEVEL).fill(null);
    const rank: number[] = new Array(MAX_LEVEL).fill(0);
    let x = this.head;

    for (let i = this.level - 1; i >= 0; i--) {
      rank[i] = i === this.level - 1 ? 0 : rank[i + 1];
      while (
        x.forward[i] !== null &&
        this.compare(x.forward[i]!.score, x.forward[i]!.member, score, member) < 0
      ) {
        rank[i] += 1 << i;
        x = x.forward[i]!;
      }
      update[i] = x;
    }

    const newLevel = this.randomLevel();

    if (newLevel > this.level) {
      for (let i = this.level; i < newLevel; i++) {
        rank[i] = 0;
        update[i] = this.head;
      }
      this.level = newLevel;
    }

    x = new SkipListNode(score, member, newLevel);

    for (let i = 0; i < newLevel; i++) {
      x.forward[i] = update[i]!.forward[i];
      update[i]!.forward[i] = x;
    }

    if (update[0] === this.head) {
      x.backward = null;
    } else {
      x.backward = update[0];
    }

    if (x.forward[0] !== null) {
      x.forward[0]!.backward = x;
    } else {
      this.tail = x;
    }

    this.length++;
    return rank[0] + 1;
  }

  delete(score: number, member: string): boolean {
    const update: (SkipListNode | null)[] = new Array(MAX_LEVEL).fill(null);
    let x = this.head;

    for (let i = this.level - 1; i >= 0; i--) {
      while (
        x.forward[i] !== null &&
        this.compare(x.forward[i]!.score, x.forward[i]!.member, score, member) < 0
      ) {
        x = x.forward[i]!;
      }
      update[i] = x;
    }

    x = x.forward[0]!;
    if (x === null || this.compare(x.score, x.member, score, member) !== 0) {
      return false;
    }

    for (let i = 0; i < this.level; i++) {
      if (update[i]!.forward[i] === x) {
        update[i]!.forward[i] = x.forward[i];
      }
    }

    if (x.forward[0] !== null) {
      x.forward[0]!.backward = x.backward;
    } else {
      this.tail = x.backward;
    }

    while (this.level > 1 && this.head.forward[this.level - 1] === null) {
      this.level--;
    }

    this.length--;
    return true;
  }

  getRank(score: number, member: string): number {
    let rank = 0;
    let x = this.head.forward[0];
    while (x !== null) {
      rank++;
      if (x.score === score && x.member === member) {
        return rank;
      }
      x = x.forward[0];
    }
    return 0;
  }

  getElementByRank(rank: number): { score: number; member: string } | null {
    if (rank < 1 || rank > this.length) return null;

    let x = this.head.forward[0];
    let current = 1;
    while (x !== null && current < rank) {
      x = x.forward[0];
      current++;
    }
    if (x === null) return null;
    return { score: x.score, member: x.member };
  }

  rangeByScore(minScore: number, maxScore: number): { score: number; member: string }[] {
    const result: { score: number; member: string }[] = [];
    let x: SkipListNode | null = this.head;

    for (let i = this.level - 1; i >= 0; i--) {
      while (x.forward[i] !== null && x.forward[i]!.score < minScore) {
        x = x.forward[i]!;
      }
    }

    x = x.forward[0];
    while (x !== null && x.score <= maxScore) {
      result.push({ score: x.score, member: x.member });
      x = x.forward[0];
    }

    return result;
  }

  size(): number {
    return this.length;
  }
}
