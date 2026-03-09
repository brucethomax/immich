import {
  type DuplicateSelectionRule,
  getDefaultDuplicateRules,
  rankDuplicates,
  suggestDuplicate,
} from '$lib/utils/duplicate-utils';
import type { AssetResponseDto } from '@immich/sdk';

describe('choosing a duplicate (default rules)', () => {
  it('picks the asset with the largest file size', () => {
    const assets = [
      { exifInfo: { fileSizeInByte: 300 } },
      { exifInfo: { fileSizeInByte: 200 } },
      { exifInfo: { fileSizeInByte: 100 } },
    ];
    expect(suggestDuplicate(assets as AssetResponseDto[])).toEqual(assets[0]);
  });

  it('picks the asset with the most exif data if multiple assets have the same file size', () => {
    const assets = [
      { exifInfo: { fileSizeInByte: 200, rating: 5, fNumber: 1 } },
      { exifInfo: { fileSizeInByte: 200, rating: 5 } },
      { exifInfo: { fileSizeInByte: 100, rating: 5 } },
    ];
    expect(suggestDuplicate(assets as AssetResponseDto[])).toEqual(assets[0]);
  });

  it('returns undefined for an empty array', () => {
    const assets: AssetResponseDto[] = [];
    expect(suggestDuplicate(assets)).toBeUndefined();
  });

  it('handles assets with no exifInfo', () => {
    const assets = [{ exifInfo: { fileSizeInByte: 200 } }, {}];
    expect(suggestDuplicate(assets as AssetResponseDto[])).toEqual(assets[0]);
  });

  it('handles assets with exifInfo but no fileSizeInByte', () => {
    const assets = [{ exifInfo: { rating: 5, fNumber: 1 } }, { exifInfo: { rating: 5 } }];
    expect(suggestDuplicate(assets as AssetResponseDto[])).toEqual(assets[0]);
  });

  it('picks the asset with the shorter original file name when file size and exif are equal', () => {
    const assets = [
      { originalFileName: 'test-2.jpg', exifInfo: { fileSizeInByte: 200, rating: 5 } },
      { originalFileName: 'test.jpg', exifInfo: { fileSizeInByte: 200, rating: 5 } },
    ];
    expect(suggestDuplicate(assets as AssetResponseDto[])).toEqual(assets[1]);
  });

  it('picks the asset with with the largest file size even if original file is longer', () => {
    const assets = [
      { originalFileName: 'test-2.jpg', exifInfo: { fileSizeInByte: 300, rating: 5 } },
      { originalFileName: 'test.jpg', exifInfo: { fileSizeInByte: 200, rating: 5 } },
    ];
    expect(suggestDuplicate(assets as AssetResponseDto[])).toEqual(assets[0]);
  });
});

describe('choosing a duplicate (custom rules)', () => {
  it('picks smallest file when rule direction is asc', () => {
    const rules: DuplicateSelectionRule[] = [{ type: 'file-size', enabled: true, direction: 'asc' }];
    const assets = [
      { exifInfo: { fileSizeInByte: 300 } },
      { exifInfo: { fileSizeInByte: 100 } },
      { exifInfo: { fileSizeInByte: 200 } },
    ];
    expect(suggestDuplicate(assets as AssetResponseDto[], rules)).toEqual(assets[1]);
  });

  it('picks newest date when date-original desc is used', () => {
    const rules: DuplicateSelectionRule[] = [{ type: 'date-original', enabled: true, direction: 'desc' }];
    const assets = [
      { exifInfo: { dateTimeOriginal: '2020-01-01T00:00:00Z' }, localDateTime: '2020-01-01T00:00:00Z' },
      { exifInfo: { dateTimeOriginal: '2024-06-15T12:30:00Z' }, localDateTime: '2024-06-15T12:30:00Z' },
      { exifInfo: { dateTimeOriginal: '2022-03-10T08:00:00Z' }, localDateTime: '2022-03-10T08:00:00Z' },
    ];
    expect(suggestDuplicate(assets as AssetResponseDto[], rules)).toEqual(assets[1]);
  });

  it('picks oldest date when date-original asc is used', () => {
    const rules: DuplicateSelectionRule[] = [{ type: 'date-original', enabled: true, direction: 'asc' }];
    const assets = [
      { exifInfo: { dateTimeOriginal: '2020-01-01T00:00:00Z' }, localDateTime: '2020-01-01T00:00:00Z' },
      { exifInfo: { dateTimeOriginal: '2024-06-15T12:30:00Z' }, localDateTime: '2024-06-15T12:30:00Z' },
    ];
    expect(suggestDuplicate(assets as AssetResponseDto[], rules)).toEqual(assets[0]);
  });

  it('picks alphabetically first filename', () => {
    const rules: DuplicateSelectionRule[] = [{ type: 'filename-alpha', enabled: true, direction: 'asc' }];
    const assets = [
      { originalFileName: 'banana.jpg' },
      { originalFileName: 'apple.jpg' },
      { originalFileName: 'cherry.jpg' },
    ];
    expect(suggestDuplicate(assets as AssetResponseDto[], rules)).toEqual(assets[1]);
  });

  it('picks alphabetically last filename when direction is desc', () => {
    const rules: DuplicateSelectionRule[] = [{ type: 'filename-alpha', enabled: true, direction: 'desc' }];
    const assets = [
      { originalFileName: 'banana.jpg' },
      { originalFileName: 'apple.jpg' },
      { originalFileName: 'cherry.jpg' },
    ];
    expect(suggestDuplicate(assets as AssetResponseDto[], rules)).toEqual(assets[2]);
  });

  it('picks highest resolution asset', () => {
    const rules: DuplicateSelectionRule[] = [{ type: 'image-resolution', enabled: true, direction: 'desc' }];
    const assets = [
      { exifInfo: { exifImageWidth: 1920, exifImageHeight: 1080 } },
      { exifInfo: { exifImageWidth: 3840, exifImageHeight: 2160 } },
      { exifInfo: { exifImageWidth: 1280, exifImageHeight: 720 } },
    ];
    expect(suggestDuplicate(assets as AssetResponseDto[], rules)).toEqual(assets[1]);
  });

  it('prefers asset with GPS location', () => {
    const rules: DuplicateSelectionRule[] = [{ type: 'has-location', enabled: true, direction: 'desc' }];
    const assets = [{ exifInfo: {} }, { exifInfo: { latitude: 40.7128, longitude: -74.006 } }];
    expect(suggestDuplicate(assets as AssetResponseDto[], rules)).toEqual(assets[1]);
  });

  it('prefers asset with more precise EXIF values (4.38mm over 4.4mm)', () => {
    const rules: DuplicateSelectionRule[] = [{ type: 'exif-precision', enabled: true, direction: 'desc' }];
    const assets = [
      { exifInfo: { focalLength: 4.4, fNumber: 1.7, iso: 650, exposureTime: '1/17' } },
      { exifInfo: { focalLength: 4.38, fNumber: 1.7, iso: 650, exposureTime: '1/17' } },
    ];
    expect(suggestDuplicate(assets as AssetResponseDto[], rules)).toEqual(assets[1]);
  });

  it('skips disabled rules', () => {
    const rules: DuplicateSelectionRule[] = [
      { type: 'file-size', enabled: false, direction: 'desc' },
      { type: 'filename-alpha', enabled: true, direction: 'asc' },
    ];
    const assets = [
      { originalFileName: 'banana.jpg', exifInfo: { fileSizeInByte: 300 } },
      { originalFileName: 'apple.jpg', exifInfo: { fileSizeInByte: 100 } },
    ];
    // file-size is disabled, so filename-alpha picks 'apple' (asc)
    expect(suggestDuplicate(assets as AssetResponseDto[], rules)).toEqual(assets[1]);
  });

  it('applies rules in priority order (first rule breaks ties first)', () => {
    const rules: DuplicateSelectionRule[] = [
      { type: 'file-size', enabled: true, direction: 'desc' },
      { type: 'filename-alpha', enabled: true, direction: 'asc' },
    ];
    const assets = [
      { originalFileName: 'banana.jpg', exifInfo: { fileSizeInByte: 300 } },
      { originalFileName: 'apple.jpg', exifInfo: { fileSizeInByte: 300 } },
      { originalFileName: 'cherry.jpg', exifInfo: { fileSizeInByte: 100 } },
    ];
    // file-size desc narrows to banana & apple (both 300), then filename-alpha asc picks apple
    expect(suggestDuplicate(assets as AssetResponseDto[], rules)).toEqual(assets[1]);
  });

  it('getDefaultDuplicateRules returns expected defaults', () => {
    const defaults = getDefaultDuplicateRules();
    expect(defaults.length).toBe(9);
    expect(defaults[0]).toEqual({ type: 'has-location', enabled: true, direction: 'desc' });
    expect(defaults[1]).toEqual({ type: 'exif-completeness', enabled: true, direction: 'desc' });
    expect(defaults[2]).toEqual({ type: 'exif-precision', enabled: true, direction: 'desc' });
    expect(defaults[3]).toEqual({ type: 'file-size', enabled: true, direction: 'desc' });
    expect(defaults[4]).toEqual({ type: 'image-resolution', enabled: true, direction: 'desc' });
    expect(defaults[5]).toEqual({ type: 'filename-length', enabled: true, direction: 'asc' });
    // Remaining rules should exist but be disabled
    expect(defaults.filter((r) => r.enabled).length).toBe(6);
    expect(defaults.filter((r) => !r.enabled).length).toBe(3);
  });
});

describe('rankDuplicates', () => {
  it('sorts best keeper first by file size desc', () => {
    const rules: DuplicateSelectionRule[] = [{ type: 'file-size', enabled: true, direction: 'desc' }];
    const assets = [
      { exifInfo: { fileSizeInByte: 100 } },
      { exifInfo: { fileSizeInByte: 300 } },
      { exifInfo: { fileSizeInByte: 200 } },
    ];
    const ranked = rankDuplicates(assets as AssetResponseDto[], rules);
    expect(ranked).toEqual([assets[1], assets[2], assets[0]]);
  });

  it('sorts best keeper first by file size asc', () => {
    const rules: DuplicateSelectionRule[] = [{ type: 'file-size', enabled: true, direction: 'asc' }];
    const assets = [
      { exifInfo: { fileSizeInByte: 300 } },
      { exifInfo: { fileSizeInByte: 100 } },
      { exifInfo: { fileSizeInByte: 200 } },
    ];
    const ranked = rankDuplicates(assets as AssetResponseDto[], rules);
    expect(ranked).toEqual([assets[1], assets[2], assets[0]]);
  });

  it('sorts by filename alphabetically asc', () => {
    const rules: DuplicateSelectionRule[] = [{ type: 'filename-alpha', enabled: true, direction: 'asc' }];
    const assets = [
      { originalFileName: 'cherry.jpg' },
      { originalFileName: 'apple.jpg' },
      { originalFileName: 'banana.jpg' },
    ];
    const ranked = rankDuplicates(assets as AssetResponseDto[], rules);
    expect(ranked).toEqual([assets[1], assets[2], assets[0]]);
  });

  it('uses secondary rule to break ties', () => {
    const rules: DuplicateSelectionRule[] = [
      { type: 'file-size', enabled: true, direction: 'desc' },
      { type: 'filename-alpha', enabled: true, direction: 'asc' },
    ];
    const assets = [
      { originalFileName: 'banana.jpg', exifInfo: { fileSizeInByte: 300 } },
      { originalFileName: 'apple.jpg', exifInfo: { fileSizeInByte: 300 } },
      { originalFileName: 'cherry.jpg', exifInfo: { fileSizeInByte: 100 } },
    ];
    const ranked = rankDuplicates(assets as AssetResponseDto[], rules);
    // Both 300-byte files first (apple before banana by alpha), then cherry
    expect(ranked).toEqual([assets[1], assets[0], assets[2]]);
  });

  it('returns single-element array unchanged', () => {
    const assets = [{ exifInfo: { fileSizeInByte: 100 } }];
    const ranked = rankDuplicates(assets as AssetResponseDto[]);
    expect(ranked).toEqual(assets);
  });

  it('first element matches suggestDuplicate result', () => {
    const rules: DuplicateSelectionRule[] = [
      { type: 'file-size', enabled: true, direction: 'desc' },
      { type: 'exif-completeness', enabled: true, direction: 'desc' },
    ];
    const assets = [
      { exifInfo: { fileSizeInByte: 100 } },
      { exifInfo: { fileSizeInByte: 300, fNumber: 1 } },
      { exifInfo: { fileSizeInByte: 200 } },
    ];
    const ranked = rankDuplicates(assets as AssetResponseDto[], rules);
    const suggested = suggestDuplicate(assets as AssetResponseDto[], rules);
    expect(ranked[0]).toEqual(suggested);
  });
});
