import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avatarDetectionProblem } from '../server/avatar-policy.js'
import { cropRectangle } from '../src/utils/avatar-crop.js'
const face = { box: { probability: 0.95 }, pose: { yaw: 20, pitch: -20, roll: 20 } }
test('single frontal face accepts exact confidence and pose limits', () => {
  assert.equal(avatarDetectionProblem({ result: [face] }), null)
})
test('empty, multiple, low-confidence and side faces are rejected', () => {
  assert.equal(avatarDetectionProblem({ result: [] }).code, 'NO_FACE')
  assert.equal(avatarDetectionProblem({ result: [face, face] }).code, 'MULTIPLE_FACES')
  assert.equal(avatarDetectionProblem({ result: [{ ...face, box: { probability: 0.949 } }] }).code, 'INVALID_FACE')
  for (const axis of ['yaw', 'pitch', 'roll']) for (const angle of [-20.01, 20.01]) {
    assert.equal(avatarDetectionProblem({ result: [{ ...face, pose: { ...face.pose, [axis]: angle } }] }).code, 'FACE_NOT_FRONTAL')
  }
})
test('malformed detector data fails closed', () => {
  for (const data of [null, {}, { result: {} }, { result: [null] }, { result: [{}] },
    { result: [{ ...face, box: { probability: '0.99' } }] },
    { result: [{ ...face, box: { probability: 2 } }] },
    { result: [{ ...face, pose: { yaw: 0, pitch: NaN, roll: 0 } }] }]) {
    assert.equal(avatarDetectionProblem(data).status, 503)
  }
})
test('crop preserves a square inside landscape, portrait and square images at every edge', () => {
  assert.deepEqual(cropRectangle(800, 600), { x: 100, y: 0, size: 600 })
  for (const [width, height] of [[800,600], [600,800], [512,512]]) {
    for (const zoom of [1,2,3]) for (const x of [-100,0,100]) for (const y of [-100,0,100]) {
      const r = cropRectangle(width, height, zoom, x, y)
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.size <= width && r.y + r.size <= height)
    }
  }
  assert.throws(() => cropRectangle(0, 100))
  assert.throws(() => cropRectangle(100, 100, NaN))
})
