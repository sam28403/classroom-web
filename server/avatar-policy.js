// Pure validation shared by the HTTP adapter and unit tests.
export function avatarDetectionProblem(data) {
  const unavailable = { status: 503, code: 'FACE_UNAVAILABLE', message: '人脸检测服务未返回有效姿态信息' }
  if (!Array.isArray(data?.result)) return unavailable
  if (!data.result.length) return { status: 422, code: 'NO_FACE', message: '未检测到人脸，请上传本人正脸照片' }
  if (data.result.length !== 1) return { status: 422, code: 'MULTIPLE_FACES', message: '请上传只有一人的照片' }
  const face = data.result[0], probability = face?.box?.probability, pose = face?.pose
  if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !pose ||
      !['yaw', 'pitch', 'roll'].every(key => Number.isFinite(pose[key]))) return unavailable
  if (probability < 0.95) return { status: 422, code: 'INVALID_FACE', message: '人脸不清晰，请重新拍摄' }
  if (['yaw', 'pitch', 'roll'].some(key => Math.abs(pose[key]) > 20)) {
    return { status: 422, code: 'FACE_NOT_FRONTAL', message: '请上传面向镜头的正脸照片' }
  }
  return null
}
