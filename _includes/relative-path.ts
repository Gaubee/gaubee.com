import path from 'node:path';

export const relativePath = (base: string, p: string) => {
  const relativePath = path.posix.relative(base, p);
  if (p.endsWith('/') && !relativePath.endsWith('/') && relativePath !== '') {
    return relativePath + '/';
  }
  return relativePath;
};
