export const getAcronym = (name: string) => {
  let acronym = ((name || '').match(/\b(\w)/g) || []).join('').slice(0, 2).toUpperCase()
  if (acronym.length === 1) {
    acronym = acronym + name.slice(1, 2).toLowerCase()
  }
  return acronym
}
