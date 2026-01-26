import { Controller, Get, Post, Delete, Param, UseGuards, Request, UploadedFile, UseInterceptors, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DocumentsService } from './documents.service';
import { Response } from 'express';

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // Get my documents (contractor)
  @Get('mine')
  @ApiOperation({ summary: 'Get my documents' })
  getMyDocuments(@Request() req) {
    return this.documentsService.getMyDocuments(req.user.userId, req.user.companyId);
  }

  // Get all documents (admin)
  @Get()
  @ApiOperation({ summary: 'Get all documents (admin)' })
  getAllDocuments(@Request() req) {
    return this.documentsService.getAllForCompany(req.user.companyId);
  }

  // Upload document
  @Post()
  @ApiOperation({ summary: 'Upload a document' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documentsService.upload(req.user.userId, req.user.companyId, file, req.body);
  }

  // Get document by ID
  @Get(':id')
  @ApiOperation({ summary: 'Get document by ID' })
  getById(@Request() req, @Param('id') id: string) {
    return this.documentsService.getById(id, req.user.userId, req.user.companyId);
  }

  // Download document
  @Get(':id/download')
  @ApiOperation({ summary: 'Download document' })
  async downloadDocument(@Request() req, @Param('id') id: string, @Res() res: Response) {
    const doc = await this.documentsService.getById(id, req.user.userId, req.user.companyId);
    
    if (doc.fileData) {
      res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`);
      res.send(doc.fileData);
    } else if (doc.fileUrl) {
      res.redirect(doc.fileUrl);
    } else {
      res.status(404).send('File not found');
    }
  }

  // Delete document
  @Delete(':id')
  @ApiOperation({ summary: 'Delete document' })
  deleteDocument(@Request() req, @Param('id') id: string) {
    return this.documentsService.delete(id, req.user.userId, req.user.companyId);
  }
}
