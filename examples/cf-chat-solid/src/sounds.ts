import incomingSound from './assets/incoming.mp3'
import sentSound from './assets/sent.mp3'

const createAudio = (src: string) => {
  const audio = new Audio(src)
  audio.preload = 'auto'
  return audio
}

const incomingAudio = createAudio(incomingSound)
const sentAudio = createAudio(sentSound)

export const playIncomingSound = () => {
  incomingAudio.currentTime = 0
  incomingAudio.play().catch(() => {
    // Ignore errors (e.g., user hasn't interacted with page yet)
  })
}

export const playSentSound = () => {
  sentAudio.currentTime = 0
  sentAudio.play().catch(() => {
    // Ignore errors (e.g., user hasn't interacted with page yet)
  })
}
