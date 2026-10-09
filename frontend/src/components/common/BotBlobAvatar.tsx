import React from 'react';

interface BotBlobAvatarProps {
  name: string;
  avatarShape?: string;
  color?: string;
  className?: string;
  size?: number;
}

export const BotBlobAvatar: React.FC<BotBlobAvatarProps> = ({
  name,
  avatarShape,
  color,
  className = 'h-9 w-9',
  size = 36,
}) => {
  const normalized = name.toLowerCase();

  // Color selection logic
  const mainColor =
    color ||
    (normalized.includes('chief') || normalized.includes('orion')
      ? '#7C3AED'
      : normalized.includes('ea') || normalized.includes('assistant')
      ? '#38BDF8'
      : normalized.includes('inbox')
      ? '#10B981'
      : normalized.includes('sales')
      ? '#2DD4BF'
      : normalized.includes('talent')
      ? '#9A6B4B'
      : normalized.includes('growth') || normalized.includes('marketer')
      ? '#F97316'
      : normalized.includes('customer') || normalized.includes('support')
      ? '#FB7185'
      : normalized.includes('expense')
      ? '#EC4899'
      : normalized.includes('invoice') || normalized.includes('collector')
      ? '#6366F1'
      : '#8B5CF6');

  // Shape resolution logic
  const shape =
    avatarShape ||
    (normalized.includes('chief')
      ? 'blob'
      : normalized.includes('ea')
      ? 'teardrop'
      : normalized.includes('inbox')
      ? 'cloud'
      : normalized.includes('sales')
      ? 'double_drop'
      : normalized.includes('talent')
      ? 'circle'
      : normalized.includes('growth')
      ? 'bean'
      : normalized.includes('customer')
      ? 'oval'
      : normalized.includes('expense')
      ? 'triangle'
      : normalized.includes('invoice')
      ? 'square'
      : 'blob');

  // 1. Organic Blob (Chief style)
  if (shape === 'blob' || normalized.includes('chief')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${className} shrink-0 drop-shadow-sm`}
      >
        <path
          d="M6.5 17.5C5 11 11.5 5.5 18 5C25 4.5 31.5 9.5 31 17C30.5 24.5 24.5 31 16.5 30.5C9.5 30 7.8 23 6.5 17.5Z"
          fill={mainColor}
        />
        <circle cx="13" cy="15.5" r="1.6" fill="#FFFFFF" />
        <circle cx="18.5" cy="15" r="1.6" fill="#FFFFFF" />
      </svg>
    );
  }

  // 2. Teardrop (EA style)
  if (shape === 'teardrop' || normalized === 'ea') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${className} shrink-0 drop-shadow-sm`}
      >
        <path
          d="M18 5C18 5 9 16 9 22.5C9 27.5 13 31 18 31C23 31 27 27.5 27 22.5C27 16 18 5 18 5Z"
          fill={mainColor}
        />
        <circle cx="15" cy="20" r="1.5" fill="#FFFFFF" />
        <circle cx="21" cy="20" r="1.5" fill="#FFFFFF" />
      </svg>
    );
  }

  // 3. Cloud (Inbox Manager style)
  if (shape === 'cloud' || normalized.includes('inbox')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${className} shrink-0 drop-shadow-sm`}
      >
        <path
          d="M10 24C7 24 5 21.5 5 18.5C5 15.5 7.5 13.5 10.5 13.5C11.5 10 14.5 8 18.5 8C23 8 26.5 10.5 27 15C29.5 15.5 31 17.5 31 20C31 22.5 29 24 26.5 24H10Z"
          fill={mainColor}
        />
        <circle cx="14" cy="17" r="1.5" fill="#FFFFFF" />
        <circle cx="20" cy="17" r="1.5" fill="#FFFFFF" />
      </svg>
    );
  }

  // 4. Double Drop (Sales Outbound style)
  if (shape === 'double_drop' || normalized.includes('sales')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${className} shrink-0 drop-shadow-sm`}
      >
        <path
          d="M13 8C13 8 7 15 7 19.5C7 23 9.5 25.5 13 25.5C16.5 25.5 19 23 19 19.5C19 15 13 8 13 8Z"
          fill={mainColor}
        />
        <path
          d="M23 15C23 15 18 20.5 18 24C18 26.5 20 28.5 23 28.5C26 28.5 28 26.5 28 24C28 20.5 23 15 23 15Z"
          fill="#0EA5E9"
        />
        <circle cx="11.5" cy="18" r="1.3" fill="#FFFFFF" />
        <circle cx="21.5" cy="22" r="1.3" fill="#FFFFFF" />
      </svg>
    );
  }

  // 5. Circle Pebble (Talent Scout style)
  if (shape === 'circle' || normalized.includes('talent')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${className} shrink-0 drop-shadow-sm`}
      >
        <circle cx="18" cy="18" r="12" fill={mainColor} />
        <circle cx="14" cy="17" r="1.6" fill="#FFFFFF" />
        <circle cx="21" cy="17" r="1.6" fill="#FFFFFF" />
      </svg>
    );
  }

  // 6. Kidney Bean (Growth Marketer style)
  if (shape === 'bean' || normalized.includes('growth')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${className} shrink-0 drop-shadow-sm`}
      >
        <path
          d="M18 6C24.5 6 30 11 30 18C30 25 24.5 30 18 30C12 30 8 26 8 20C8 14 11.5 6 18 6Z"
          fill={mainColor}
        />
        <circle cx="15" cy="17" r="1.6" fill="#FFFFFF" />
        <circle cx="21" cy="17" r="1.6" fill="#FFFFFF" />
      </svg>
    );
  }

  // 7. Oval Pill (Customer Support style)
  if (shape === 'oval' || normalized.includes('customer')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${className} shrink-0 drop-shadow-sm`}
      >
        <path
          d="M6 19C6 13 11 8 18 8C25 8 30 13 30 19C30 25 25 28 18 28C11 28 6 25 6 19Z"
          fill={mainColor}
        />
        <circle cx="14" cy="18" r="1.6" fill="#FFFFFF" />
        <circle cx="21" cy="18" r="1.6" fill="#FFFFFF" />
      </svg>
    );
  }

  // 8. Rounded Triangle (Expense Manager style)
  if (shape === 'triangle' || normalized.includes('expense')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${className} shrink-0 drop-shadow-sm`}
      >
        <path
          d="M18 7C19.5 7 20.8 7.8 21.6 9.2L29.5 23.5C30.3 25 30.2 26.8 29.3 28.2C28.4 29.6 26.8 30.5 25 30.5H11C9.2 30.5 7.6 29.6 6.7 28.2C5.8 26.8 5.7 25 6.5 23.5L14.4 9.2C15.2 7.8 16.5 7 18 7Z"
          fill={mainColor}
        />
        <circle cx="14.5" cy="20" r="1.5" fill="#FFFFFF" />
        <circle cx="21.5" cy="20" r="1.5" fill="#FFFFFF" />
      </svg>
    );
  }

  // 9. Rounded Square (Invoice Collector style)
  if (shape === 'square' || normalized.includes('invoice')) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${className} shrink-0 drop-shadow-sm`}
      >
        <rect x="7" y="7" width="22" height="22" rx="7" fill={mainColor} />
        <circle cx="14" cy="15" r="1.5" fill="#FFFFFF" />
        <circle cx="21" cy="15" r="1.5" fill="#FFFFFF" />
      </svg>
    );
  }

  // Default organic blob fallback
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} shrink-0 drop-shadow-sm`}
    >
      <path
        d="M9 16C8 10 13 5 19 6C25 7 29 11 29 18C29 25 24 29 17 29C10 29 10 22 9 16Z"
        fill={mainColor}
      />
      <circle cx="15" cy="16" r="1.5" fill="#FFFFFF" />
      <circle cx="21" cy="16" r="1.5" fill="#FFFFFF" />
    </svg>
  );
};

export default BotBlobAvatar;
