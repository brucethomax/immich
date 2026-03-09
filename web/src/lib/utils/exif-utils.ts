import type { AssetResponseDto } from '@immich/sdk';

export const getExifCount = (asset: AssetResponseDto) => {
  return Object.values(asset.exifInfo ?? {}).filter(Boolean).length;
};

/**
 * Count the number of significant decimal digits in a numeric value.
 * e.g. 4.38 → 2, 4.4 → 1, 17 → 0
 */
const getDecimalPrecision = (value: number): number => {
  const str = String(value);
  const dotIndex = str.indexOf('.');
  if (dotIndex === -1) {
    return 0;
  }
  return str.length - dotIndex - 1;
};

/**
 * Count the total significant decimal digits in a string that may contain
 * numeric values (e.g. exposureTime "1/17" → digits in "1" + digits in "17").
 */
const getStringNumberPrecision = (value: string): number => {
  const numbers = value.match(/\d+\.?\d*/g);
  if (!numbers) {
    return 0;
  }
  return numbers.reduce((sum, n) => sum + getDecimalPrecision(Number(n)), 0);
};

/**
 * Compute a total EXIF numeric precision score for an asset.
 * Sums the decimal precision of focalLength, fNumber, iso,
 * and the numeric parts of exposureTime.
 * Higher score = more precise original metadata (less rounding).
 */
export const getExifPrecision = (asset: AssetResponseDto): number => {
  const exif = asset.exifInfo;
  if (!exif) {
    return 0;
  }
  let precision = 0;
  if (exif.focalLength != null) {
    precision += getDecimalPrecision(exif.focalLength);
  }
  if (exif.fNumber != null) {
    precision += getDecimalPrecision(exif.fNumber);
  }
  if (exif.iso != null) {
    precision += getDecimalPrecision(exif.iso);
  }
  if (exif.exposureTime != null) {
    precision += getStringNumberPrecision(exif.exposureTime);
  }
  return precision;
};
