export type EssayPrimaryType = 'summary' | 'analysis' | 'countermeasure' | 'practical_writing' | 'essay';

export interface EssayPaper {
  _id: string;
  title: string;
  year: number;
  exam_type: 'national' | 'provincial' | string;
  paper_level: string;
  source_kind?: string;
  total_score: number;
  question_count: number;
  material_count: number;
}

export interface EssayMaterial {
  _id: string;
  paper_id: string;
  sequence: number;
  title: string;
  content: string;
}

export interface EssayQuestion {
  _id: string;
  paper_id: string;
  sequence: number;
  primary_type: EssayPrimaryType;
  subtype: string;
  document_genre?: string;
  material_ids: string[];
  prompt: string;
  score: number;
  requirements: {
    min_words?: number;
    max_words?: number;
    items?: string[];
  };
}

export interface EssayAnswer {
  question_id: string;
  answer_type: string;
  reference_answer: string;
  answer_outline?: string[];
  essay_title?: string;
}

export interface EssayPaperDetail {
  paper: EssayPaper;
  materials: EssayMaterial[];
  questions: EssayQuestion[];
}
