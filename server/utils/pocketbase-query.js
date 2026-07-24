export async function getBoundedList(
  pb,
  collectionName,
  options = {},
  limit = 500,
) {
  const pageSize = Math.min(500, Math.max(1, Number(limit) || 500));
  const result = await pb
    .collection(collectionName)
    .getList(1, pageSize, options);
  return result.items;
}

export async function deleteMatchingRecords(
  pb,
  collectionName,
  filter,
  batchSize = 100,
) {
  let deleted = 0;
  while (true) {
    const records = await getBoundedList(
      pb,
      collectionName,
      { filter, fields: "id" },
      batchSize,
    );
    if (!records.length) return deleted;
    await Promise.all(
      records.map((record) => pb.collection(collectionName).delete(record.id)),
    );
    deleted += records.length;
  }
}
