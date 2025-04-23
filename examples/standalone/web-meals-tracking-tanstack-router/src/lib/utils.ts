export const convertMacroQuantity = ({
  quantity,
  macro,
}: {
  quantity: number;
  macro: number;
}) => macro * (quantity / 100);
