# 一人称3D試作

## 目的と役割

AIサムが脱出し、プレイヤーは病院として妨害する構造を維持します。プレイヤーはサムをWASDで移動させず、サムの目から見回して4つの干渉を使います。元の受賞版の7部屋とルールを共有した、ブラウザ上で操作できる最初の3D版です。

## 実装の境界

- `src/three/world.ts` と `renderer.ts`: 共有マップから病院の3D空間を生成し、サムと追跡者の位置を描画します。状態は描画側から変更しません。
- `src/three/game.ts` と `game.css`: 3D版の開始・停止・干渉・結果・再挑戦、音、部屋選択、APIセッションのライフサイクルを管理します。
- `src/simulation.ts` と `src/live-contract.ts`: 引き継いだルールとAPI要求。実モデルを描画フレームごとに呼び出しません。
- `/`: 3D版。`/classic`: 従来の2D版。Three.jsはクライアント側で動的に読み込み、サーバーからブラウザのWebGLを参照しません。
- 新しいSite IDを使用し、既存の受賞版のSite・秘密設定・公開範囲には変更しません。実API検証スクリプトの固定originはこの3D版の公開先へ切り替えます。

## 試作の制限

病院と追跡者は手続き生成の形状です。完成した人物モデル、美術、視覚認識モデル、自由歩行、モバイル実機保証は含みません。WebGL2が必要です。AI待ちの間は従来通りゲーム時間を止めます。移動中の封鎖で位置が戻る既存ルールを維持し、大きな位置の不連続は描画で軽減します。物理移動・接触・知覚の全面的な再設計は次段階です。

ローカルAIは既存の決定的ルールで動き、OpenAIのモデルを呼びません。実APIモードでは既存のサインインと秘密設定が必要で、設定がない場合はそのモードを選べません。実APIの失敗をローカルAIへ自動切り替えしません。

## 公式資料

- [Three.js installation](https://threejs.org/manual/pages/installation.html)
- [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Resource disposal](https://threejs.org/manual/pages/how-to-dispose-of-objects.html)

公開試作の動作確認と、実APIを含むデモ合格は区別します。デモ合格には [実APIデモチェック](live-demo-check.md) の同一公開コミットでの検証が必要です。
