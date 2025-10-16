export default async function generateAddressPairs(sellAddrs, buyAddrs, distanceMap) {
  const addressPairs = [];

  // Gerar pares (from: sellAddress, to: buyAddress)
  for (const from of sellAddrs) {
    for (const to of buyAddrs) {
      // Verificar se a distância já existe
      const existingDistance = distanceMap.get(`${from._id}_${to._id}`);

      if (!existingDistance) {
        addressPairs.push({ from, to });
      }
    }
  }
  return addressPairs;
}
