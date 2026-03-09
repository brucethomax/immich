import { getExifCount, getExifPrecision } from '$lib/utils/exif-utils';
import type { AssetResponseDto } from '@immich/sdk';

describe('getting the exif count', () => {
  it('returns 0 when exifInfo is undefined', () => {
    const asset = {};
    expect(getExifCount(asset as AssetResponseDto)).toBe(0);
  });

  it('returns 0 when exifInfo is empty', () => {
    const asset = { exifInfo: {} };
    expect(getExifCount(asset as AssetResponseDto)).toBe(0);
  });

  it('returns the correct count of non-null exifInfo properties', () => {
    const asset = { exifInfo: { fileSizeInByte: 200, rating: 5, fNumber: null } };
    expect(getExifCount(asset as AssetResponseDto)).toBe(2);
  });

  it('ignores null, undefined and empty properties in exifInfo', () => {
    const asset = { exifInfo: { fileSizeInByte: 200, rating: null, fNumber: undefined, description: '' } };
    expect(getExifCount(asset as AssetResponseDto)).toBe(1);
  });

  it('returns the correct count when all exifInfo properties are non-null', () => {
    const asset = { exifInfo: { fileSizeInByte: 200, rating: 5, fNumber: 1, description: 'test' } };
    expect(getExifCount(asset as AssetResponseDto)).toBe(4);
  });
});

describe('getExifPrecision', () => {
  it('returns 0 when exifInfo is undefined', () => {
    expect(getExifPrecision({} as AssetResponseDto)).toBe(0);
  });

  it('returns 0 when all values are integers', () => {
    const asset = { exifInfo: { focalLength: 4, fNumber: 2, iso: 650 } };
    expect(getExifPrecision(asset as AssetResponseDto)).toBe(0);
  });

  it('counts decimal digits of focalLength', () => {
    const asset = { exifInfo: { focalLength: 4.38 } };
    expect(getExifPrecision(asset as AssetResponseDto)).toBe(2);
  });

  it('counts decimal digits of fNumber', () => {
    const asset = { exifInfo: { fNumber: 1.75 } };
    expect(getExifPrecision(asset as AssetResponseDto)).toBe(2);
  });

  it('sums precision across multiple fields', () => {
    // 4.38 → 2 decimals, 1.7 → 1 decimal, 650 → 0, "1/17" → 0
    const asset = { exifInfo: { focalLength: 4.38, fNumber: 1.7, iso: 650, exposureTime: '1/17' } };
    expect(getExifPrecision(asset as AssetResponseDto)).toBe(3);
  });

  it('differentiates 4.38mm (2 decimals) from 4.4mm (1 decimal)', () => {
    const precise = { exifInfo: { focalLength: 4.38, fNumber: 1.7, iso: 650, exposureTime: '1/17' } };
    const rounded = { exifInfo: { focalLength: 4.4, fNumber: 1.7, iso: 650, exposureTime: '1/17' } };
    expect(getExifPrecision(precise as AssetResponseDto)).toBeGreaterThan(
      getExifPrecision(rounded as AssetResponseDto),
    );
  });

  it('counts precision in exposureTime string fractions', () => {
    const asset = { exifInfo: { exposureTime: '1/2.5' } };
    // "1" → 0 decimals, "2.5" → 1 decimal = total 1
    expect(getExifPrecision(asset as AssetResponseDto)).toBe(1);
  });
});
