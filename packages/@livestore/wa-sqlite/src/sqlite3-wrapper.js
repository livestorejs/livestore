import install from './sqlite3.js'

const wrapper = {}

const init = () => {
  install(wrapper)
  return wrapper.self.sqlite3InitModule(wrapper)
}

export default init
