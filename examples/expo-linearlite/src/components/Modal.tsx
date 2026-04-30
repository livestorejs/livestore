import { XIcon } from 'lucide-react-native'
import type React from 'react'
import { useMemo } from 'react'
import { Pressable, Modal as RNModal, StyleSheet, useColorScheme, View } from 'react-native'

import { Colors } from '../constants/Colors.ts'

interface CustomModalProps {
  visible: boolean
  onClose: () => void
  children: React.ReactNode
}

export const Modal = ({ visible, onClose, children }: CustomModalProps) => {
  const theme = useColorScheme()
  const themedModalContainerStyle = useMemo(
    () => StyleSheet.compose(styles.modalContainer, { backgroundColor: Colors[theme!].background }),
    [theme],
  )

  return (
    <RNModal transparent={true} animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={themedModalContainerStyle}>
        <Pressable style={styles.closeButton} onPress={onClose}>
          <XIcon color="gray" />
        </Pressable>
        {children}
      </View>
    </RNModal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  modalContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    top: 16,
    zIndex: 1,
  },
  closeIcon: {
    width: 20,
    height: 20,
    backgroundColor: 'red',
    borderRadius: 10,
  },
})
