-- Doctor favourites for ICD-10 diagnoses (star in the ICD catalog drawer).
ALTER TYPE "CatalogEntityType" ADD VALUE IF NOT EXISTS 'ICD10';
