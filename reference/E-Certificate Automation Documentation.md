**1. Project Description**

The E-Certificate Automation Project is a web-based system built using AppSheet and

Google Sheets. Its goal is to replace manual paperwork with an automated digital workflow.

The system allows employees to submit certificate requests for hardware or software

acquisitions and renewals, which are then routed through a predefined chain of departmental

approvers for digital signatures and final PDF generation.

2\. Access Roles and Permissions

To access the system, the app owner must share the app with specific roles. There are two

primary roles defined in the AppSheet share settings, as seen in image 1.

Admin Role

● Access Level: “Edit app”

● In-App Role: “Admin”

● App Version: “Latest”

● Permissions: Admins can view and edit the Approver\_Settings table to manage who

approves requests for each department. They also have full visibility into the

Certificate\_Requests table, allowing them to see all requests made by every user in the

organization.

User Role

● Access Level: “Use app”

● In-App Role: “User”

● App Version: “Latest”

● Permissions: Users cannot see or edit the Approver\_Settings table. They can only

access the Certificate\_Requests table and are restricted to viewing only the requests

they have personally submitted.

Image 1. AppSheet share settings

3\. Table Details

Approver\_Settings Table

This table is managed solely by the Admin to define the approval hierarchy for different groups

(departments).

● How to add: The Admin clicks the "Add" button to open a form.

● Required Fields: Group (Department), Approver 1 (Email), and Approver 1’s Designation

(Position).

● Optional Fields: Approver 2 (Email), Approver 2’s Designation, Approver 3 (Email), and

Approver 3’s Designation.

● Admin Control: The Admin can add new settings or edit existing rows to update the

approvers for a specific group.

Image 2. Appearance of Approver Settings Table Database

Image 3. Example of Approver Settings Form

Certificate\_Requests Table

This is where the core request activity happens. Users create requests by clicking "Add," which

generates a unique Control Number.

● Request Form Fields:

○ Control Number (Generates a unique ID) (i.e. EC-2026-00001-64f)

○ Project Title

○ Date of Filing (Calendar picker)

○ Requestor (The email of the requestor is shown)

○ Requestor’s Designation (Input the Requestor’s Position)

○ Group (Target Department)

○ Accountable Person and their Department

○ Location (Options: AGT, GCP, EGP, TWS, or "Other" by adding their own location)

○ PC Name, Purchase Order (PO), PRISM No, and iHelp Number.

○ Product Type (Hardware or Software) and Product Name.

○ Type of Purchase (New Acquisition, Renewal, or Replacement).

○ Type of License

○ Contract Period (Start and End Dates).

○ Supplier Name

○ Requestor’s Remark (Purpose of request).

○ Supporting Documents: Users can attach multiple files by clicking "New", which a

Request Attachment Form appears where users can upload the file, and provide an

"Attachment Label" description.

Image 4. Request Attachments Form

Image 5. Example of Certificate Requests Form

4\. How the Workflow Works

Step 1: Submission

Once the user saves the request form, the system automatically identifies the Approver 1

assigned to that specific group and sends them an email notification.

Step 2: Approval Actions

The approver receives a digital card containing all request details and three action buttons:

1\. Approve: Moves the request to the next approver in the chain (Approver 2, then

Approver 3).

2\. Decline: Stops the request immediately. Approver Remark is mandatory. The system

notifies the requestor that the request is void and they must start a new one.

3\. Return Request: Sends the request back to the user for corrections. Approver Remark

is mandatory. Once the user resubmits, it goes back to Approver 1.

Step 3: Confirmations

Every time an approver clicks Approve, Decline, or Return, the system sends a confirmation

email to that specific approver to verify their action was successful.

Step 4: Final Completion

When the final required approver provides their approval, the system changes the status to

"Fully Approved." It then automatically generates a Certificate of Completion PDF and emails

it directly to the requestor as an attachment.

Image 6. Example of Certificate of Completion

5\. Project Links

● E-Certification Automation App (Browser View):

https://www.appsheet.com/start/90f04812-4642-4c6b-b671-b738b8ef3489

● E-Certification Automation App (Editor/Admin View):

https://www.appsheet.com/Template/AppDef?appName=E-CertificateAutomation-8648

48063

● Google Sheet Database:

https://docs.google.com/spreadsheets/d/12-o9ERCer1kPSEM8B0oaeKVk8XV3JNtSO8fu5

4kamS4/edit?usp=sharing

● Google Drive Folder (Attachments \& PDFs):

https://drive.google.com/drive/folders/1RJ1P7vZXgLa85KfsdQKCLBLqsaDqde-Y?usp=driv

e\_link

