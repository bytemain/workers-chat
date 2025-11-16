export const hashCode = (name) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    let character = name.charCodeAt(i);
    hash = (hash << 5) - hash + character;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
};
