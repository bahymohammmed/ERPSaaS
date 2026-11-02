'use client';

import { useParams } from 'next/navigation';
import { SettlementEditor } from '@/components/subledger/SettlementEditor';

const Page = () => {
  const { id } = useParams<{ id: string }>();
  return <SettlementEditor key={id} side="AP" id={id} />;
};

export default Page;
